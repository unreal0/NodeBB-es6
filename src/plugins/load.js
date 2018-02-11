var path = require('path');
var semver = require('semver');
var async = require('async');
var winston = require('winston');
var nconf = require('nconf');
var _ = require('lodash');

var meta = require('../meta');

module.exports = (Plugins) => {
	function registerPluginAssets(pluginData, fields, callback) {
		function add(dest, arr) {
			dest.push.apply(dest, arr || []);
		}

		var handlers = {
			staticDirs: (next) => {
				Plugins.data.getStaticDirectories(pluginData, next);
			},
			cssFiles: (next) => {
				Plugins.data.getFiles(pluginData, 'css', next);
			},
			lessFiles: (next) => {
				Plugins.data.getFiles(pluginData, 'less', next);
			},
			acpLessFiles: (next) => {
				Plugins.data.getFiles(pluginData, 'acpLess', next);
			},
			clientScripts: (next) => {
				Plugins.data.getScripts(pluginData, 'client', next);
			},
			acpScripts: (next) => {
				Plugins.data.getScripts(pluginData, 'acp', next);
			},
			modules: (next) => {
				Plugins.data.getModules(pluginData, next);
			},
			soundpack: (next) => {
				Plugins.data.getSoundpack(pluginData, next);
			},
			languageData: (next) => {
				Plugins.data.getLanguageData(pluginData, next);
			},
		};

		var methods;
		if (Array.isArray(fields)) {
			methods = fields.reduce((prev, field) => {
				prev[field] = handlers[field];
				return prev;
			}, {});
		} else {
			methods = handlers;
		}

		async.parallel(methods, (err, results) => {
			if (err) {
				return callback(err);
			}

			Object.assign(Plugins.staticDirs, results.staticDirs || {});
			add(Plugins.cssFiles, results.cssFiles);
			add(Plugins.lessFiles, results.lessFiles);
			add(Plugins.acpLessFiles, results.acpLessFiles);
			add(Plugins.clientScripts, results.clientScripts);
			add(Plugins.acpScripts, results.acpScripts);
			Object.assign(meta.js.scripts.modules, results.modules || {});
			if (results.soundpack) {
				Plugins.soundpacks.push(results.soundpack);
			}
			if (results.languageData) {
				Plugins.languageData.languages = _.union(Plugins.languageData.languages, results.languageData.languages);
				Plugins.languageData.namespaces = _.union(Plugins.languageData.namespaces, results.languageData.namespaces);
			}
			Plugins.pluginsData[pluginData.id] = pluginData;

			callback();
		});
	}

	Plugins.prepareForBuild = (targets, callback) => {
		Plugins.cssFiles.length = 0;
		Plugins.lessFiles.length = 0;
		Plugins.acpLessFiles.length = 0;
		Plugins.clientScripts.length = 0;
		Plugins.acpScripts.length = 0;
		Plugins.soundpacks.length = 0;
		Plugins.languageData.languages = [];
		Plugins.languageData.namespaces = [];

		var map = {
			'plugin static dirs': ['staticDirs'],
			'requirejs modules': ['modules'],
			'client js bundle': ['clientScripts'],
			'admin js bundle': ['acpScripts'],
			'client side styles': ['cssFiles', 'lessFiles'],
			'admin control panel styles': ['cssFiles', 'lessFiles', 'acpLessFiles'],
			sounds: ['soundpack'],
			languages: ['languageData'],
		};

		var fields = targets.reduce((prev, target) => {
			if (!map[target]) {
				return prev;
			}
			return prev.concat(map[target]);
		}, []).filter((field, i, arr) => arr.indexOf(field) === i);

		winston.verbose('[plugins] loading the following fields from plugin data: ' + fields.join(', '));

		async.waterfall([
			Plugins.data.getActive,
			(plugins, next) => {
				async.each(plugins, (pluginData, next) => {
					registerPluginAssets(pluginData, fields, next);
				}, next);
			},
		], callback);
	};

	Plugins.loadPlugin = (pluginPath, callback) => {
		Plugins.data.loadPluginInfo(pluginPath, (err, pluginData) => {
			if (err) {
				if (err.message === '[[error:parse-error]]') {
					return callback();
				}
				return callback(pluginPath.match('nodebb-theme') ? null : err);
			}

			checkVersion(pluginData);

			async.parallel([
				(next) => {
					registerHooks(pluginData, next);
				},
				(next) => {
					registerPluginAssets(pluginData, ['soundpack'], next);
				},
			], (err) => {
				if (err) {
					winston.verbose('[plugins] Could not load plugin : ' + pluginData.id);
					return callback(err);
				}

				winston.verbose('[plugins] Loaded plugin: ' + pluginData.id);
				callback();
			});
		});
	};

	function checkVersion(pluginData) {
		const add = () => {
			if (Plugins.versionWarning.indexOf(pluginData.id) === -1) {
				Plugins.versionWarning.push(pluginData.id);
			}
		};

		if (pluginData.nbbpm && pluginData.nbbpm.compatibility && semver.validRange(pluginData.nbbpm.compatibility)) {
			if (!semver.satisfies(nconf.get('version'), pluginData.nbbpm.compatibility)) {
				add();
			}
		} else {
			add();
		}
	}

	function registerHooks(pluginData, callback) {
		if (!pluginData.library) {
			return callback();
		}

		var libraryPath = path.join(pluginData.path, pluginData.library);

		try {
			if (!Plugins.libraries[pluginData.id]) {
				Plugins.requireLibrary(pluginData.id, libraryPath);
			}

			if (Array.isArray(pluginData.hooks) && pluginData.hooks.length > 0) {
				async.each(pluginData.hooks, (hook, next) => {
					Plugins.registerHook(pluginData.id, hook, next);
				}, callback);
			} else {
				callback();
			}
		} catch (err) {
			winston.error(err.stack);
			winston.warn('[plugins] Unable to parse library for: ' + pluginData.id);
			callback();
		}
	}
};
