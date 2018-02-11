var fs = require('fs');
var path = require('path');
var async = require('async');
var winston = require('winston');
var semver = require('semver');
var express = require('express');
var nconf = require('nconf');

var hotswap = require('./hotswap');
var file = require('./file');

var app;
var middleware;

var Plugins = module.exports;

require('./plugins/install')(Plugins);
require('./plugins/load')(Plugins);
require('./plugins/hooks')(Plugins);
Plugins.data = require('./plugins/data');

Plugins.getPluginPaths = Plugins.data.getPluginPaths;
Plugins.loadPluginInfo = Plugins.data.loadPluginInfo;

Plugins.pluginsData = {};
Plugins.libraries = {};
Plugins.loadedHooks = {};
Plugins.staticDirs = {};
Plugins.cssFiles = [];
Plugins.lessFiles = [];
Plugins.acpLessFiles = [];
Plugins.clientScripts = [];
Plugins.acpScripts = [];
Plugins.libraryPaths = [];
Plugins.versionWarning = [];
Plugins.soundpacks = [];
Plugins.languageData = {};

Plugins.initialized = false;

Plugins.requireLibrary = (pluginID, libraryPath) => {
	Plugins.libraries[pluginID] = require(libraryPath);
	Plugins.libraryPaths.push(libraryPath);
};

Plugins.init = (nbbApp, nbbMiddleware, callback) => {
	callback = callback || function () {};
	if (Plugins.initialized) {
		return callback();
	}

	if (nbbApp) {
		app = nbbApp;
		middleware = nbbMiddleware;
		hotswap.prepare(nbbApp);
	}

	if (global.env === 'development') {
		winston.verbose('[plugins] Initializing plugins system');
	}

	Plugins.reload((err) => {
		if (err) {
			winston.error('[plugins] NodeBB encountered a problem while loading plugins', err);
			return callback(err);
		}

		if (global.env === 'development') {
			winston.info('[plugins] Plugins OK');
		}

		Plugins.initialized = true;
		callback();
	});
};

Plugins.reload = (callback) => {
	// Resetting all local plugin data
	Plugins.libraries = {};
	Plugins.loadedHooks = {};
	Plugins.staticDirs = {};
	Plugins.versionWarning = [];
	Plugins.cssFiles.length = 0;
	Plugins.lessFiles.length = 0;
	Plugins.acpLessFiles.length = 0;
	Plugins.clientScripts.length = 0;
	Plugins.acpScripts.length = 0;
	Plugins.libraryPaths.length = 0;

	async.waterfall([
		Plugins.getPluginPaths,
		(paths, next) => {
			async.eachSeries(paths, Plugins.loadPlugin, next);
		},
		(next) => {
			// If some plugins are incompatible, throw the warning here
			if (Plugins.versionWarning.length && nconf.get('isPrimary') === 'true') {
				console.log('');
				winston.warn('[plugins/load] The following plugins may not be compatible with your version of NodeBB. This may cause unintended behaviour or crashing. In the event of an unresponsive NodeBB caused by this plugin, run `./nodebb reset -p PLUGINNAME` to disable it.');
				for (var x = 0, numPlugins = Plugins.versionWarning.length; x < numPlugins; x += 1) {
					console.log('  * '.yellow + Plugins.versionWarning[x]);
				}
				console.log('');
			}

			Object.keys(Plugins.loadedHooks).forEach((hook) => {
				var hooks = Plugins.loadedHooks[hook];
				hooks.sort((a, b) => a.priority - b.priority);
			});

			next();
		},
	], callback);
};

Plugins.reloadRoutes = (callback) => {
	var router = express.Router();

	router.hotswapId = 'plugins';
	router.render = () => {
		app.render.apply(app, arguments);
	};

	var controllers = require('./controllers');
	Plugins.fireHook('static:app.load', { app: app, router: router, middleware: middleware, controllers: controllers }, (err) => {
		if (err) {
			winston.error('[plugins] Encountered error while executing post-router plugins hooks', err);
			return callback(err);
		}

		hotswap.replace('plugins', router);
		winston.verbose('[plugins] All plugins reloaded and rerouted');
		callback();
	});
};

// DEPRECATED: remove in v1.8.0
Plugins.getTemplates = (callback) => {
	var templates = {};
	var tplName;

	winston.warn('[deprecated] Plugins.getTemplates is DEPRECATED to be removed in v1.8.0');

	Plugins.data.getActive((err, plugins) => {
		if (err) {
			return callback(err);
		}

		async.eachSeries(plugins, (plugin, next) => {
			if (plugin.templates || plugin.id.startsWith('nodebb-theme-')) {
				winston.verbose('[plugins] Loading templates (' + plugin.id + ')');
				var templatesPath = path.join(__dirname, '../node_modules', plugin.id, plugin.templates || 'templates');
				file.walk(templatesPath, (err, pluginTemplates) => {
					if (pluginTemplates) {
						pluginTemplates.forEach((pluginTemplate) => {
							if (pluginTemplate.endsWith('.tpl')) {
								tplName = '/' + pluginTemplate.replace(templatesPath, '').substring(1);

								if (templates.hasOwnProperty(tplName)) {
									winston.verbose('[plugins] ' + tplName + ' replaced by ' + plugin.id);
								}

								templates[tplName] = pluginTemplate;
							} else {
								winston.warn('[plugins] Skipping ' + pluginTemplate + ' by plugin ' + plugin.id);
							}
						});
					} else if (err) {
						winston.error(err);
					} else {
						winston.warn('[plugins/' + plugin.id + '] A templates directory was defined for this plugin, but was not found.');
					}

					next(false);
				});
			} else {
				next(false);
			}
		}, (err) => {
			callback(err, templates);
		});
	});
};

Plugins.get = (id, callback) => {
	var url = (nconf.get('registry') || 'https://packages.nodebb.org') + '/api/v1/plugins/' + id;

	require('request')(url, {
		json: true,
	}, (err, res, body) => {
		if (res.statusCode === 404 || !body.payload) {
			return callback(err, {});
		}

		Plugins.normalise([body.payload], (err, normalised) => {
			normalised = normalised.filter((plugin) => plugin.id === id);
			return callback(err, !err ? normalised[0] : undefined);
		});
	});
};
// function不能转箭头
Plugins.list = function (matching, callback) {
	if (arguments.length === 1 && typeof matching === 'function') {
		callback = matching;
		matching = true;
	}
	var version = require(path.join(nconf.get('base_dir'), 'package.json')).version;
	var url = (nconf.get('registry') || 'https://packages.nodebb.org') + '/api/v1/plugins' + (matching !== false ? '?version=' + version : '');

	require('request')(url, {
		json: true,
	}, (err, res, body) => {
		if (err || (res && res.statusCode !== 200)) {
			winston.error('Error loading ' + url, err || body);
			return Plugins.normalise([], callback);
		}

		Plugins.normalise(body, callback);
	});
};

Plugins.normalise = (apiReturn, callback) => {
	var pluginMap = {};
	var dependencies = require(path.join(nconf.get('base_dir'), 'package.json')).dependencies;
	apiReturn = Array.isArray(apiReturn) ? apiReturn : [];
	for (var i = 0; i < apiReturn.length; i += 1) {
		apiReturn[i].id = apiReturn[i].name;
		apiReturn[i].installed = false;
		apiReturn[i].active = false;
		apiReturn[i].url = apiReturn[i].url || (apiReturn[i].repository ? apiReturn[i].repository.url : '');
		pluginMap[apiReturn[i].name] = apiReturn[i];
	}

	Plugins.showInstalled((err, installedPlugins) => {
		if (err) {
			return callback(err);
		}

		installedPlugins = installedPlugins.filter((plugin) => plugin && !plugin.system);

		async.each(installedPlugins, (plugin, next) => {
			// If it errored out because a package.json or plugin.json couldn't be read, no need to do this stuff
			if (plugin.error) {
				pluginMap[plugin.id] = pluginMap[plugin.id] || {};
				pluginMap[plugin.id].installed = true;
				pluginMap[plugin.id].error = true;
				return next();
			}

			pluginMap[plugin.id] = pluginMap[plugin.id] || {};
			pluginMap[plugin.id].id = pluginMap[plugin.id].id || plugin.id;
			pluginMap[plugin.id].name = plugin.name || pluginMap[plugin.id].name;
			pluginMap[plugin.id].description = plugin.description;
			pluginMap[plugin.id].url = pluginMap[plugin.id].url || plugin.url;
			pluginMap[plugin.id].installed = true;
			pluginMap[plugin.id].isTheme = !!plugin.id.match('nodebb-theme-');
			pluginMap[plugin.id].error = plugin.error || false;
			pluginMap[plugin.id].active = plugin.active;
			pluginMap[plugin.id].version = plugin.version;
			pluginMap[plugin.id].settingsRoute = plugin.settingsRoute;
			pluginMap[plugin.id].license = plugin.license;

			// If package.json defines a version to use, stick to that
			if (dependencies.hasOwnProperty(plugin.id) && semver.valid(dependencies[plugin.id])) {
				pluginMap[plugin.id].latest = dependencies[plugin.id];
			} else {
				pluginMap[plugin.id].latest = pluginMap[plugin.id].latest || plugin.version;
			}
			pluginMap[plugin.id].outdated = semver.gt(pluginMap[plugin.id].latest, pluginMap[plugin.id].version);
			next();
		}, (err) => {
			if (err) {
				return callback(err);
			}

			var pluginArray = [];

			for (var key in pluginMap) {
				if (pluginMap.hasOwnProperty(key)) {
					pluginArray.push(pluginMap[key]);
				}
			}

			pluginArray.sort((a, b) => {
				if (a.name > b.name) {
					return 1;
				} else if (a.name < b.name) {
					return -1;
				}
				return 0;
			});

			callback(null, pluginArray);
		});
	});
};

Plugins.nodeModulesPath = path.join(__dirname, '../node_modules');

Plugins.showInstalled = (callback) => {
	var pluginNamePattern = /^(@.*?\/)?nodebb-(theme|plugin|widget|rewards)-.*$/;

	async.waterfall([
		(next) => {
			fs.readdir(Plugins.nodeModulesPath, next);
		},
		(dirs, next) => {
			var pluginPaths = [];

			async.each(dirs, (dirname, next) => {
				var dirPath = path.join(Plugins.nodeModulesPath, dirname);

				async.waterfall([
					(cb) => {
						fs.stat(dirPath, (err, stats) => {
							if (err && err.code !== 'ENOENT') {
								return cb(err);
							}
							if (err || !stats.isDirectory()) {
								return next();
							}

							if (pluginNamePattern.test(dirname)) {
								pluginPaths.push(dirname);
								return next();
							}

							if (dirname[0] !== '@') {
								return next();
							}
							fs.readdir(dirPath, cb);
						});
					},
					(subdirs, cb) => {
						async.each(subdirs, (subdir, next) => {
							if (!pluginNamePattern.test(subdir)) {
								return next();
							}

							var subdirPath = path.join(dirPath, subdir);
							fs.stat(subdirPath, (err, stats) => {
								if (err && err.code !== 'ENOENT') {
									return next(err);
								}

								if (err || !stats.isDirectory()) {
									return next();
								}

								pluginPaths.push(dirname + '/' + subdir);
								next();
							});
						}, cb);
					},
				], next);
			}, (err) => {
				next(err, pluginPaths);
			});
		},

		(dirs, next) => {
			dirs = dirs.map((dir) => path.join(Plugins.nodeModulesPath, dir));
			var plugins = [];

			async.each(dirs, (file, next) => {
				async.waterfall([
					(next) => {
						Plugins.loadPluginInfo(file, next);
					},
					(pluginData, next) => {
						Plugins.isActive(pluginData.name, (err, active) => {
							if (err) {
								return next(new Error('no-active-state'));
							}

							delete pluginData.hooks;
							delete pluginData.library;
							pluginData.active = active;
							pluginData.installed = true;
							pluginData.error = false;
							next(null, pluginData);
						});
					},
				], (err, pluginData) => {
					if (err) {
						return next(); // Silently fail
					}

					plugins.push(pluginData);
					next();
				});
			}, (err) => {
				next(err, plugins);
			});
		},
	], callback);
};
