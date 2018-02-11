var fs = require('fs');
var path = require('path');
var async = require('async');
var nconf = require('nconf');
var plugins = require('../plugins');

var admin = {};

admin.get = (callback) => {
	async.parallel({
		areas: (next) => {
			var defaultAreas = [
				{ name: 'Global Sidebar', template: 'global', location: 'sidebar' },
				{ name: 'Global Header', template: 'global', location: 'header' },
				{ name: 'Global Footer', template: 'global', location: 'footer' },

				{ name: 'Group Page (Left)', template: 'groups/details.tpl', location: 'left' },
				{ name: 'Group Page (Right)', template: 'groups/details.tpl', location: 'right' },
			];

			plugins.fireHook('filter:widgets.getAreas', defaultAreas, next);
		},
		widgets: (next) => {
			plugins.fireHook('filter:widgets.getWidgets', [], next);
		},
		adminTemplate: (next) => {
			fs.readFile(path.resolve(nconf.get('views_dir'), 'admin/partials/widget-settings.tpl'), 'utf8', next);
		},
	}, (err, widgetData) => {
		if (err) {
			return callback(err);
		}
		widgetData.areas.push({ name: 'Draft Zone', template: 'global', location: 'drafts' });

		async.each(widgetData.areas, (area, next) => {
			require('./index').getArea(area.template, area.location, (err, areaData) => {
				area.data = areaData;
				next(err);
			});
		}, (err) => {
			if (err) {
				return callback(err);
			}

			widgetData.widgets.forEach((w) => {
				w.content += widgetData.adminTemplate;
			});

			var templates = [];
			var list = {};
			var index = 0;

			widgetData.areas.forEach((area) => {
				if (typeof list[area.template] === 'undefined') {
					list[area.template] = index;
					templates.push({
						template: area.template,
						areas: [],
					});

					index += 1;
				}

				templates[list[area.template]].areas.push({
					name: area.name,
					location: area.location,
				});
			});

			callback(false, {
				templates: templates,
				areas: widgetData.areas,
				availableWidgets: widgetData.widgets,
			});
		});
	});
};

module.exports = admin;
