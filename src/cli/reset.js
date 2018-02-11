

require('colors');
var path = require('path');
var winston = require('winston');
var async = require('async');
var fs = require('fs');

var db = require('../database');
var events = require('../events');
var meta = require('../meta');
var plugins = require('../plugins');
var widgets = require('../widgets');

var dirname = require('./paths').baseDir;

exports.reset = (options, callback) => {
	var map = {
		theme: (next) => {
			var themeId = options.theme;
			if (themeId === true) {
				resetThemes(next);
			} else {
				if (!themeId.startsWith('nodebb-theme-')) {
					// Allow omission of `nodebb-theme-`
					themeId = 'nodebb-theme-' + themeId;
				}

				resetTheme(themeId, next);
			}
		},
		plugin: (next) => {
			var pluginId = options.plugin;
			if (pluginId === true) {
				resetPlugins(next);
			} else {
				if (!pluginId.startsWith('nodebb-plugin-')) {
					// Allow omission of `nodebb-plugin-`
					pluginId = 'nodebb-plugin-' + pluginId;
				}

				resetPlugin(pluginId, next);
			}
		},
		widgets: resetWidgets,
		settings: resetSettings,
		all: (next) => {
			async.series([resetWidgets, resetThemes, resetPlugins, resetSettings], next);
		},
	};

	var tasks = Object.keys(map)
		.filter(x => options[x])
		.map(x => map[x]);

	if (!tasks.length) {
		console.log([
			'No arguments passed in, so nothing was reset.\n'.yellow,
			'Use ./nodebb reset ' + '{-t|-p|-w|-s|-a}'.red,
			'    -t\tthemes',
			'    -p\tplugins',
			'    -w\twidgets',
			'    -s\tsettings',
			'    -a\tall of the above',
			'',
			'Plugin and theme reset flags (-p & -t) can take a single argument',
			'    e.g. ./nodebb reset -p nodebb-plugin-mentions, ./nodebb reset -t nodebb-theme-persona',
			'         Prefix is optional, e.g. ./nodebb reset -p markdown, ./nodebb reset -t persona',
		].join('\n'));

		process.exit(0);
	}

	async.series([db.init].concat(tasks), (err) => {
		if (err) {
			winston.error('[reset] Errors were encountered during reset', err);
			throw err;
		}

		winston.info('[reset] Reset complete');
		callback();
	});
};

function resetSettings(callback) {
	meta.configs.set('allowLocalLogin', 1, (err) => {
		winston.info('[reset] Settings reset to default');
		callback(err);
	});
}

function resetTheme(themeId, callback) {
	fs.access(path.join(dirname, 'node_modules', themeId, 'package.json'), (err) => {
		if (err) {
			winston.warn('[reset] Theme `%s` is not installed on this forum', themeId);
			callback(new Error('theme-not-found'));
		} else {
			meta.themes.set({
				type: 'local',
				id: themeId,
			}, (err) => {
				if (err) {
					winston.warn('[reset] Failed to reset theme to ' + themeId);
				} else {
					winston.info('[reset] Theme reset to ' + themeId);
				}

				callback();
			});
		}
	});
}

function resetThemes(callback) {
	meta.themes.set({
		type: 'local',
		id: 'nodebb-theme-persona',
	}, (err) => {
		winston.info('[reset] Theme reset to Persona');
		callback(err);
	});
}

function resetPlugin(pluginId, callback) {
	var active = false;

	async.waterfall([
		async.apply(db.isSortedSetMember, 'plugins:active', pluginId),
		(isMember, next) => {
			active = isMember;

			if (isMember) {
				db.sortedSetRemove('plugins:active', pluginId, next);
			} else {
				next();
			}
		},
		(next) => {
			events.log({
				type: 'plugin-deactivate',
				text: pluginId,
			}, next);
		},
	], (err) => {
		if (err) {
			winston.error('[reset] Could not disable plugin: %s encountered error %s', pluginId, err);
		} else if (active) {
			winston.info('[reset] Plugin `%s` disabled', pluginId);
		} else {
			winston.warn('[reset] Plugin `%s` was not active on this forum', pluginId);
			winston.info('[reset] No action taken.');
			err = new Error('plugin-not-active');
		}

		callback(err);
	});
}

function resetPlugins(callback) {
	db.delete('plugins:active', (err) => {
		winston.info('[reset] All Plugins De-activated');
		callback(err);
	});
}

function resetWidgets(callback) {
	async.waterfall([
		plugins.reload,
		widgets.reset,
		(next) => {
			winston.info('[reset] All Widgets moved to Draft Zone');
			next();
		},
	], callback);
}
