var async = require('async');
var winston = require('winston');
var user = require('../user');
var meta = require('../meta');
var plugins = require('../plugins');
var jsesc = require('jsesc');

var controllers = {
	api: require('../controllers/api'),
	helpers: require('../controllers/helpers'),
};

module.exports = (middleware) => {
	middleware.admin = {};
	middleware.admin.isAdmin = (req, res, next) => {
		winston.warn('[middleware.admin.isAdmin] deprecation warning, no need to use this from plugins!');
		middleware.isAdmin(req, res, next);
	};

	middleware.admin.buildHeader = (req, res, next) => {
		res.locals.renderAdminHeader = true;

		async.waterfall([
			(next) => {
				controllers.api.getConfig(req, res, next);
			},
			(config, next) => {
				res.locals.config = config;
				next();
			},
		], next);
	};

	middleware.admin.renderHeader = (req, res, data, next) => {
		var custom_header = {
			plugins: [],
			authentication: [],
		};

		async.waterfall([
			(next) => {
				async.parallel({
					userData: (next) => {
						user.getUserFields(req.uid, ['username', 'userslug', 'email', 'picture', 'email:confirmed'], next);
					},
					scripts: (next) => {
						getAdminScripts(next);
					},
					custom_header: (next) => {
						plugins.fireHook('filter:admin.header.build', custom_header, next);
					},
					config: (next) => {
						controllers.api.getConfig(req, res, next);
					},
					configs: (next) => {
						meta.configs.list(next);
					},
				}, next);
			},
			(results, next) => {
				var userData = results.userData;
				userData.uid = req.uid;
				userData['email:confirmed'] = parseInt(userData['email:confirmed'], 10) === 1;

				res.locals.config = results.config;

				var acpPath = req.path.slice(1).split('/');
				acpPath.forEach((path, i) => {
					acpPath[i] = path.charAt(0).toUpperCase() + path.slice(1);
				});
				acpPath = acpPath.join(' > ');

				var templateValues = {
					config: results.config,
					configJSON: jsesc(JSON.stringify(results.config), { isScriptContext: true }),
					relative_path: results.config.relative_path,
					adminConfigJSON: encodeURIComponent(JSON.stringify(results.configs)),
					user: userData,
					userJSON: jsesc(JSON.stringify(userData), { isScriptContext: true }),
					plugins: results.custom_header.plugins,
					authentication: results.custom_header.authentication,
					scripts: results.scripts,
					'cache-buster': meta.config['cache-buster'] || '',
					env: !!process.env.NODE_ENV,
					title: (acpPath || 'Dashboard') + ' | NodeBB Admin Control Panel',
					bodyClass: data.bodyClass,
				};

				templateValues.template = { name: res.locals.template };
				templateValues.template[res.locals.template] = true;

				req.app.render('admin/header', templateValues, next);
			},
		], next);
	};

	function getAdminScripts(callback) {
		async.waterfall([
			(next) => {
				plugins.fireHook('filter:admin.scripts.get', [], next);
			},
			(scripts, next) => {
				next(null, scripts.map(script => ({ src: script })));
			},
		], callback);
	}

	middleware.admin.renderFooter = (req, res, data, next) => {
		req.app.render('admin/footer', data, next);
	};
};
