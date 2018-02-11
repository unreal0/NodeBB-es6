var async = require('async');
var winston = require('winston');
var _ = require('lodash');
var Benchpress = require('benchpressjs');

var plugins = require('../plugins');
var translator = require('../translator');
var db = require('../database');
var apiController = require('../controllers/api');

var widgets = module.exports;

widgets.render = (uid, options, callback) => {
	if (!options.template) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	async.waterfall([
		(next) => {
			widgets.getWidgetDataForTemplates(['global', options.template], next);
		},
		(data, next) => {
			var widgetsByLocation = {};

			delete data.global.drafts;

			var locations = _.uniq(Object.keys(data.global).concat(Object.keys(data[options.template])));

			var returnData = {};

			async.each(locations, (location, done) => {
				widgetsByLocation[location] = (data[options.template][location] || []).concat(data.global[location] || []);

				if (!widgetsByLocation[location].length) {
					return done(null, { location: location, widgets: [] });
				}

				async.map(widgetsByLocation[location], (widget, next) => {
					if (!widget || !widget.data ||
						(!!widget.data['hide-registered'] && uid !== 0) ||
						(!!widget.data['hide-guests'] && uid === 0) ||
						(!!widget.data['hide-mobile'] && options.req.useragent.isMobile)) {
						return next();
					}

					renderWidget(widget, uid, options, next);
				}, (err, renderedWidgets) => {
					if (err) {
						return done(err);
					}
					returnData[location] = renderedWidgets.filter(Boolean);
					done();
				});
			}, (err) => {
				next(err, returnData);
			});
		},
	], callback);
};

function renderWidget(widget, uid, options, callback) {
	async.waterfall([
		(next) => {
			if (options.res.locals.isAPI) {
				apiController.loadConfig(options.req, next);
			} else {
				next(null, options.res.locals.config);
			}
		},
		(config, next) => {
			var templateData = _.assign({ }, options.templateData, { config: config });
			plugins.fireHook('filter:widget.render:' + widget.widget, {
				uid: uid,
				area: options,
				templateData: templateData,
				data: widget.data,
				req: options.req,
				res: options.res,
			}, next);
		},
		(data, next) => {
			if (!data) {
				return callback();
			}
			var html = data;
			if (typeof html !== 'string') {
				html = data.html;
			} else {
				winston.warn('[widgets.render] passing a string is deprecated!, filter:widget.render:' + widget.widget + '. Please set hookData.html in your plugin.');
			}

			if (widget.data.container && widget.data.container.match('{body}')) {
				Benchpress.compileParse(widget.data.container, {
					title: widget.data.title,
					body: html,
				}, next);
			} else {
				next(null, html);
			}
		},
		(html, next) => {
			translator.translate(html, (translatedHtml) => {
				next(null, { html: translatedHtml });
			});
		},
	], callback);
}

widgets.getWidgetDataForTemplates = (templates, callback) => {
	var keys = templates.map(tpl => (
		'widgets:' + tpl
	));

	async.waterfall([
		(next) => {
			db.getObjects(keys, next);
		},
		(data, next) => {
			var returnData = {};

			templates.forEach((template, index) => {
				returnData[template] = returnData[template] || {};

				var templateWidgetData = data[index] || {};
				var locations = Object.keys(templateWidgetData);

				locations.forEach((location) => {
					if (templateWidgetData && templateWidgetData[location]) {
						try {
							returnData[template][location] = JSON.parse(templateWidgetData[location]);
						} catch (err) {
							winston.error('can not parse widget data. template:  ' + template + ' location: ' + location);
							returnData[template][location] = [];
						}
					} else {
						returnData[template][location] = [];
					}
				});
			});

			next(null, returnData);
		},
	], callback);
};

widgets.getArea = (template, location, callback) => {
	async.waterfall([
		(next) => {
			db.getObjectField('widgets:' + template, location, next);
		},
		(result, next) => {
			if (!result) {
				return callback(null, []);
			}
			try {
				result = JSON.parse(result);
			} catch (err) {
				return callback(err);
			}

			next(null, result);
		},
	], callback);
};

widgets.setArea = (area, callback) => {
	if (!area.location || !area.template) {
		return callback(new Error('Missing location and template data'));
	}

	db.setObjectField('widgets:' + area.template, area.location, JSON.stringify(area.widgets), callback);
};

widgets.reset = (callback) => {
	var defaultAreas = [
		{ name: 'Draft Zone', template: 'global', location: 'header' },
		{ name: 'Draft Zone', template: 'global', location: 'footer' },
		{ name: 'Draft Zone', template: 'global', location: 'sidebar' },
	];
	var drafts;
	async.waterfall([
		(next) => {
			async.parallel({
				areas: (next) => {
					plugins.fireHook('filter:widgets.getAreas', defaultAreas, next);
				},
				drafts: (next) => {
					widgets.getArea('global', 'drafts', next);
				},
			}, next);
		},
		(results, next) => {
			drafts = results.drafts || [];

			async.eachSeries(results.areas, (area, next) => {
				async.waterfall([
					(next) => {
						widgets.getArea(area.template, area.location, next);
					},
					(areaData, next) => {
						drafts = drafts.concat(areaData);
						area.widgets = [];
						widgets.setArea(area, next);
					},
				], next);
			}, next);
		},
		(next) => {
			widgets.setArea({
				template: 'global',
				location: 'drafts',
				widgets: drafts,
			}, next);
		},
	], callback);
};

widgets.resetTemplate = (template, callback) => {
	var toBeDrafted = [];
	async.waterfall([
		(next) => {
			db.getObject('widgets:' + template + '.tpl', next);
		},
		(area, next) => {
			for (var location in area) {
				if (area.hasOwnProperty(location)) {
					toBeDrafted = toBeDrafted.concat(JSON.parse(area[location]));
				}
			}
			db.delete('widgets:' + template + '.tpl', next);
		},
		(next) => {
			db.getObjectField('widgets:global', 'drafts', next);
		},
		(draftWidgets, next) => {
			draftWidgets = JSON.parse(draftWidgets).concat(toBeDrafted);
			db.setObjectField('widgets:global', 'drafts', JSON.stringify(draftWidgets), next);
		},
	], callback);
};

widgets.resetTemplates = (templates, callback) => {
	async.eachSeries(templates, widgets.resetTemplate, callback);
};

module.exports = widgets;
