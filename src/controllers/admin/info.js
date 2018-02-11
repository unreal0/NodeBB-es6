

var async = require('async');
var os = require('os');
var winston = require('winston');
var nconf = require('nconf');
var exec = require('child_process').exec;

var pubsub = require('../../pubsub');
var rooms = require('../../socket.io/admin/rooms');

var infoController = module.exports;

var info = {};

infoController.get = (req, res) => {
	info = {};
	pubsub.publish('sync:node:info:start');
	var timeoutMS = 1000;
	setTimeout(() => {
		var data = [];
		Object.keys(info).forEach((key) => {
			data.push(info[key]);
		});
		data.sort((a, b) => {
			if (a.id < b.id) {
				return -1;
			}
			if (a.id > b.id) {
				return 1;
			}
			return 0;
		});
		res.render('admin/development/info', {
			info: data,
			infoJSON: JSON.stringify(data, null, 4),
			host: os.hostname(),
			port: nconf.get('port'),
			nodeCount: data.length,
			timeout: timeoutMS,
		});
	}, timeoutMS);
};

pubsub.on('sync:node:info:start', () => {
	getNodeInfo((err, data) => {
		if (err) {
			return winston.error(err);
		}
		data.id = os.hostname() + ':' + nconf.get('port');
		pubsub.publish('sync:node:info:end', { data: data, id: data.id });
	});
});

pubsub.on('sync:node:info:end', (data) => {
	info[data.id] = data.data;
});

function getNodeInfo(callback) {
	var data = {
		process: {
			port: nconf.get('port'),
			pid: process.pid,
			title: process.title,
			version: process.version,
			memoryUsage: process.memoryUsage(),
			uptime: process.uptime(),
		},
		os: {
			hostname: os.hostname(),
			type: os.type(),
			platform: os.platform(),
			arch: os.arch(),
			release: os.release(),
			load: os.loadavg().map(load => load.toFixed(2)).join(', '),
		},
	};

	data.process.memoryUsage.humanReadable = (data.process.memoryUsage.rss / (1024 * 1024)).toFixed(2);

	async.waterfall([
		(next) => {
			async.parallel({
				stats: (next) => {
					rooms.getLocalStats(next);
				},
				gitInfo: (next) => {
					getGitInfo(next);
				},
			}, next);
		},
		(results, next) => {
			data.git = results.gitInfo;
			data.stats = results.stats;
			next(null, data);
		},
	], callback);
}

function getGitInfo(callback) {
	function get(cmd, callback) {
		exec(cmd, (err, stdout) => {
			if (err) {
				winston.error(err);
			}
			callback(null, stdout ? stdout.replace(/\n$/, '') : 'no-git-info');
		});
	}
	async.parallel({
		hash: (next) => {
			get('git rev-parse HEAD', next);
		},
		branch: (next) => {
			get('git rev-parse --abbrev-ref HEAD', next);
		},
	}, callback);
}
