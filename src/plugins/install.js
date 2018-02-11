var winston = require('winston');
var async = require('async');
var path = require('path');
var fs = require('fs');
var nconf = require('nconf');
var os = require('os');
var cproc = require('child_process');

var db = require('../database');
var meta = require('../meta');
var pubsub = require('../pubsub');
var events = require('../events');

var packageManager = nconf.get('package_manager') === 'yarn' ? 'yarn' : 'npm';
var packageManagerExecutable = packageManager;
var packageManagerCommands = {
	yarn: {
		install: 'add',
		uninstall: 'remove',
	},
	npm: {
		install: 'install',
		uninstall: 'uninstall',
	},
};

if (process.platform === 'win32') {
	packageManagerExecutable += '.cmd';
}

module.exports = (Plugins) => {
	if (nconf.get('isPrimary') === 'true') {
		pubsub.on('plugins:toggleInstall', (data) => {
			if (data.hostname !== os.hostname()) {
				toggleInstall(data.id, data.version);
			}
		});

		pubsub.on('plugins:upgrade', (data) => {
			if (data.hostname !== os.hostname()) {
				upgrade(data.id, data.version);
			}
		});
	}

	Plugins.toggleActive = (id, callback) => {
		callback = callback || function () {};
		var isActive;
		async.waterfall([
			(next) => {
				Plugins.isActive(id, next);
			},
			(_isActive, next) => {
				isActive = _isActive;
				if (isActive) {
					db.sortedSetRemove('plugins:active', id, next);
				} else {
					db.sortedSetCard('plugins:active', (err, count) => {
						if (err) {
							return next(err);
						}
						db.sortedSetAdd('plugins:active', count, id, next);
					});
				}
			},
			(next) => {
				meta.reloadRequired = true;
				Plugins.fireHook(isActive ? 'action:plugin.deactivate' : 'action:plugin.activate', { id: id });
				setImmediate(next);
			},
			(next) => {
				events.log({
					type: 'plugin-' + (isActive ? 'deactivate' : 'activate'),
					text: id,
				}, next);
			},
		], (err) => {
			if (err) {
				winston.warn('[plugins] Could not toggle active state on plugin \'' + id + '\'');
				return callback(err);
			}
			callback(null, { id: id, active: !isActive });
		});
	};

	Plugins.toggleInstall = (id, version, callback) => {
		pubsub.publish('plugins:toggleInstall', { hostname: os.hostname(), id: id, version: version });
		toggleInstall(id, version, callback);
	};

	function toggleInstall(id, version, callback) {
		var installed;
		var type;
		async.waterfall([
			(next) => {
				Plugins.isInstalled(id, next);
			},
			(_installed, next) => {
				installed = _installed;
				type = installed ? 'uninstall' : 'install';
				Plugins.isActive(id, next);
			},
			(active, next) => {
				if (active) {
					Plugins.toggleActive(id, (err) => {
						next(err);
					});
					return;
				}
				setImmediate(next);
			},
			(next) => {
				runPackageManagerCommand(type, id, version || 'latest', next);
			},
			(next) => {
				Plugins.get(id, next);
			},
			(pluginData, next) => {
				Plugins.fireHook('action:plugin.' + type, { id: id, version: version });
				setImmediate(next, null, pluginData);
			},
		], callback);
	}

	function runPackageManagerCommand(command, pkgName, version, callback) {
		cproc.execFile(packageManagerExecutable, [
			packageManagerCommands[packageManager][command],
			pkgName + (command === 'install' ? '@' + version : ''),
			'--save',
		], (err, stdout) => {
			if (err) {
				return callback(err);
			}

			winston.verbose('[plugins/' + command + '] ' + stdout);
			callback();
		});
	}

	Plugins.upgrade = (id, version, callback) => {
		pubsub.publish('plugins:upgrade', { hostname: os.hostname(), id: id, version: version });
		upgrade(id, version, callback);
	};

	function upgrade(id, version, callback) {
		async.waterfall([
			async.apply(runPackageManagerCommand, 'install', id, version || 'latest'),
			(next) => {
				Plugins.isActive(id, next);
			},
			(isActive, next) => {
				meta.reloadRequired = isActive;
				next(null, isActive);
			},
		], callback);
	}

	Plugins.isInstalled = (id, callback) => {
		var pluginDir = path.join(__dirname, '../../node_modules', id);

		fs.stat(pluginDir, (err, stats) => {
			callback(null, err ? false : stats.isDirectory());
		});
	};

	Plugins.isActive = (id, callback) => {
		db.isSortedSetMember('plugins:active', id, callback);
	};

	Plugins.getActive = (callback) => {
		db.getSortedSetRange('plugins:active', 0, -1, callback);
	};
};
