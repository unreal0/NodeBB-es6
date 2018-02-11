

var async = require('async');
var plugins = require('../../plugins');

var pluginsController = module.exports;

pluginsController.get = (req, res, next) => {
	async.waterfall([
		(next) => {
			async.parallel({
				compatible: (next) => {
					plugins.list((err, plugins) => {
						if (err || !Array.isArray(plugins)) {
							plugins = [];
						}

						next(null, plugins);
					});
				},
				all: (next) => {
					plugins.list(false, (err, plugins) => {
						if (err || !Array.isArray(plugins)) {
							plugins = [];
						}

						next(null, plugins);
					});
				},
			}, next);
		},
		(payload) => {
			var compatiblePkgNames = payload.compatible.map(pkgData => pkgData.name);

			res.render('admin/extend/plugins', {
				installed: payload.compatible.filter(plugin => plugin.installed),
				upgradeCount: payload.compatible.reduce((count, current) => {
					if (current.installed && current.outdated) {
						count += 1;
					}
					return count;
				}, 0),
				download: payload.compatible.filter(plugin => !plugin.installed),
				incompatible: payload.all.filter(plugin => compatiblePkgNames.indexOf(plugin.name) === -1),
			});
		},
	], next);
};
