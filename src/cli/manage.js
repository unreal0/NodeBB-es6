

var async = require('async');
var winston = require('winston');
var childProcess = require('child_process');
var _ = require('lodash');

var build = require('../meta/build');
var db = require('../database');
var plugins = require('../plugins');
var events = require('../events');
var reset = require('./reset');

function buildTargets() {
	var aliases = build.aliases;
	var length = 0;
	var output = Object.keys(aliases).map((name) => {
		var arr = aliases[name];
		if (name.length > length) {
			length = name.length;
		}

		return [name, arr.join(', ')];
	}).map(tuple => '     ' + _.padEnd('"' + tuple[0] + '"', length + 2).magenta + '  |  ' + tuple[1]).join('\n');
	console.log(
		'\n\n  Build targets:\n' +
		('\n     ' + _.padEnd('Target', length + 2) + '  |  Aliases').green +
		'\n     ------------------------------------------------------\n'.blue +
		output + '\n'
	);
}

function activate(plugin) {
	if (plugin.startsWith('nodebb-theme-')) {
		reset.reset({
			theme: plugin,
		}, (err) => {
			if (err) { throw err; }
			process.exit();
		});
		return;
	}

	async.waterfall([
		(next) => {
			db.init(next);
		},
		(next) => {
			if (!plugin.startsWith('nodebb-')) {
				// Allow omission of `nodebb-plugin-`
				plugin = 'nodebb-plugin-' + plugin;
			}
			plugins.isInstalled(plugin, next);
		},
		(isInstalled, next) => {
			if (!isInstalled) {
				return next(new Error('plugin not installed'));
			}

			winston.info('Activating plugin `%s`', plugin);
			db.sortedSetAdd('plugins:active', 0, plugin, next);
		},
		(next) => {
			events.log({
				type: 'plugin-activate',
				text: plugin,
			}, next);
		},
	], (err) => {
		if (err) {
			winston.error('An error occurred during plugin activation', err);
			throw err;
		}
		process.exit(0);
	});
}

function listPlugins() {
	async.waterfall([
		db.init,
		(next) => {
			db.getSortedSetRange('plugins:active', 0, -1, next);
		},
		(plugins) => {
			winston.info('Active plugins: \n\t - ' + plugins.join('\n\t - '));
			process.exit();
		},
	], (err) => {
		throw err;
	});
}

function listEvents() {
	async.series([
		db.init,
		events.output,
	]);
}

function info() {
	console.log('');
	async.waterfall([
		(next) => {
			var version = require('../../package.json').version;
			console.log('  version:  ' + version);

			console.log('  Node ver: ' + process.version);
			next();
		},
		(next) => {
			var hash = childProcess.execSync('git rev-parse HEAD');
			console.log('  git hash: ' + hash);
			next();
		},
		(next) => {
			var config = require('../../config.json');
			console.log('  database: ' + config.database);
			next();
		},
		db.init,
		(next) => {
			db.info(db.client, next);
		},
		(info, next) => {
			console.log('        version: ' + info.version);
			console.log('        engine:  ' + info.storageEngine);
			next();
		},
	], (err) => {
		if (err) { throw err; }
		process.exit();
	});
}

exports.build = build.build;
exports.buildTargets = buildTargets;
exports.activate = activate;
exports.listPlugins = listPlugins;
exports.listEvents = listEvents;
exports.info = info;
