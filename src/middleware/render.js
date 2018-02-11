var async = require('async');
var nconf = require('nconf');
var validator = require('validator');
var winston = require('winston');

var plugins = require('../plugins');
var translator = require('../translator');
var widgets = require('../widgets');
var utils = require('../utils');

module.exports = (middleware) => {
	middleware.processRender = (req, res, next) => {
		// res.render post-processing, modified from here: https://gist.github.com/mrlannigan/5051687
		var render = res.render;
		// 此函数不能变为箭头函数
		res.render = function (template, options, fn) {
			var self = this;
			var req = this.req;
			var defaultFn = (err, str) => {
				if (err) {
					return next(err);
				}
				self.send(str);
			};

			options = options || {};
			if (typeof options === 'function') {
				fn = options;
				options = {};
			}
			if (typeof fn !== 'function') {
				fn = defaultFn;
			}

			var ajaxifyData;
			async.waterfall([
				(next) => {
					options.loggedIn = !!req.uid;
					options.relative_path = nconf.get('relative_path');
					options.template = { name: template };
					options.template[template] = true;
					options.url = (req.baseUrl + req.path.replace(/^\/api/, ''));
					options.bodyClass = buildBodyClass(req, options);

					plugins.fireHook('filter:' + template + '.build', { req: req, res: res, templateData: options }, next);
				},
				(data, next) => {
					plugins.fireHook('filter:middleware.render', { req: req, res: res, templateData: data.templateData }, next);
				},
				(data, next) => {
					options = data.templateData;

					widgets.render(req.uid, {
						template: template + '.tpl',
						url: options.url,
						templateData: options,
						req: req,
						res: res,
					}, next);
				},
				(data, next) => {
					options.widgets = data;

					res.locals.template = template;
					options._locals = undefined;

					if (res.locals.isAPI) {
						if (req.route && req.route.path === '/api/') {
							options.title = '[[pages:home]]';
						}

						return res.json(options);
					}

					ajaxifyData = JSON.stringify(options).replace(/<\//g, '<\\/');

					async.parallel({
						header: (next) => {
							renderHeaderFooter('renderHeader', req, res, options, next);
						},
						content: (next) => {
							render.call(self, template, options, next);
						},
						footer: (next) => {
							renderHeaderFooter('renderFooter', req, res, options, next);
						},
					}, next);
				},
				(results, next) => {
					var str = results.header +
						(res.locals.postHeader || '') +
						results.content + '<script id="ajaxify-data"></script>' +
						(res.locals.preFooter || '') +
						results.footer;

					translate(str, req, res, next);
				},
				(translated, next) => {
					translated = translated.replace('<script id="ajaxify-data"></script>', () => '<script id="ajaxify-data" type="application/json">' + ajaxifyData + '</script>');
					next(null, translated);
				},
			], fn);
		};

		next();
	};

	function renderHeaderFooter(method, req, res, options, next) {
		if (res.locals.renderHeader) {
			middleware[method](req, res, options, next);
		} else if (res.locals.renderAdminHeader) {
			middleware.admin[method](req, res, options, next);
		} else {
			next(null, '');
		}
	}

	function translate(str, req, res, next) {
		var language = (res.locals.config && res.locals.config.userLang) || 'en-GB';
		language = req.query.lang ? validator.escape(String(req.query.lang)) : language;
		translator.translate(str, language, (translated) => {
			next(null, translator.unescape(translated));
		});
	}

	function buildBodyClass(req, templateData) {
		var clean = req.path.replace(/^\/api/, '').replace(/^\/|\/$/g, '');
		var parts = clean.split('/').slice(0, 3);
		parts.forEach((p, index) => {
			try {
				p = decodeURIComponent(p);
			} catch (err) {
				winston.error(err);
				p = '';
			}
			p = validator.escape(String(p));
			parts[index] = index ? parts[0] + '-' + p : 'page-' + (p || 'home');
		});

		if (templateData.template.topic) {
			parts.push('page-topic-category-' + templateData.category.cid);
			parts.push('page-topic-category-' + utils.slugify(templateData.category.name));
		}

		return parts.join(' ');
	}
};
