var async = require('async');
var winston = require('winston');

var meta = require('../meta');
var plugins = require('../plugins');
var widgets = require('../widgets');
var user = require('../user');
var userDigest = require('../user/digest');
var userEmail = require('../user/email');
var logger = require('../logger');
var events = require('../events');
var emailer = require('../emailer');
var db = require('../database');
var analytics = require('../analytics');
var websockets = require('../socket.io/index');
var index = require('./index');
var getAdminSearchDict = require('../admin/search').getDictionary;
var utils = require('../../public/src/utils');

var SocketAdmin = {
	user: require('./admin/user'),
	categories: require('./admin/categories'),
	groups: require('./admin/groups'),
	tags: require('./admin/tags'),
	rewards: require('./admin/rewards'),
	navigation: require('./admin/navigation'),
	rooms: require('./admin/rooms'),
	social: require('./admin/social'),
	themes: {},
	plugins: {},
	widgets: {},
	config: {},
	settings: {},
	email: {},
	analytics: {},
	logs: {},
	errors: {},
};

SocketAdmin.before = (socket, method, data, next) => {
	async.waterfall([
		(next) => {
			user.isAdministrator(socket.uid, next);
		},
		(isAdmin) => {
			if (isAdmin) {
				return next();
			}
			winston.warn('[socket.io] Call to admin method ( ' + method + ' ) blocked (accessed by uid ' + socket.uid + ')');
			next(new Error('[[error:no-privileges]]'));
		},
	], next);
};

SocketAdmin.reload = (socket, data, callback) => {
	events.log({
		type: 'restart',
		uid: socket.uid,
		ip: socket.ip,
	});
	meta.restart();
	callback();
};

SocketAdmin.restart = (socket, data, callback) => {
	async.waterfall([
		(next) => {
			require('../meta/build').buildAll(next);
		},
		(next) => {
			events.log({
				type: 'build',
				uid: socket.uid,
				ip: socket.ip,
			});

			events.log({
				type: 'restart',
				uid: socket.uid,
				ip: socket.ip,
			});

			meta.restart();
			next();
		},
	], callback);
};

SocketAdmin.fireEvent = (socket, data, callback) => {
	index.server.emit(data.name, data.payload || {});
	callback();
};

SocketAdmin.themes.getInstalled = (socket, data, callback) => {
	meta.themes.get(callback);
};

SocketAdmin.themes.set = (socket, data, callback) => {
	if (!data) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	async.waterfall([
		(next) => {
			if (data.type === 'bootswatch') {
				setImmediate(next);
			} else {
				widgets.reset(next);
			}
		},
		(next) => {
			// Add uid and ip data
			data.ip = socket.ip;
			data.uid = socket.uid;

			meta.themes.set(data, next);
		},
	], callback);
};

SocketAdmin.plugins.toggleActive = (socket, plugin_id, callback) => {
	require('../posts/cache').reset();
	plugins.toggleActive(plugin_id, callback);
};

SocketAdmin.plugins.toggleInstall = (socket, data, callback) => {
	require('../posts/cache').reset();
	plugins.toggleInstall(data.id, data.version, callback);
};

SocketAdmin.plugins.getActive = (socket, data, callback) => {
	plugins.getActive(callback);
};

SocketAdmin.plugins.orderActivePlugins = (socket, data, callback) => {
	async.each(data, (plugin, next) => {
		if (plugin && plugin.name) {
			db.sortedSetAdd('plugins:active', plugin.order || 0, plugin.name, next);
		} else {
			setImmediate(next);
		}
	}, callback);
};

SocketAdmin.plugins.upgrade = (socket, data, callback) => {
	plugins.upgrade(data.id, data.version, callback);
};

SocketAdmin.widgets.set = (socket, data, callback) => {
	if (!Array.isArray(data)) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	async.eachSeries(data, widgets.setArea, callback);
};

SocketAdmin.config.set = (socket, data, callback) => {
	if (!data) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	var _data = {};
	_data[data.key] = data.value;
	SocketAdmin.config.setMultiple(socket, _data, callback);
};

SocketAdmin.config.setMultiple = (socket, data, callback) => {
	if (!data) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	async.waterfall([
		(next) => {
			meta.configs.setMultiple(data, next);
		},
		(next) => {
			var setting;
			for (var field in data) {
				if (data.hasOwnProperty(field)) {
					setting = {
						key: field,
						value: data[field],
					};
					plugins.fireHook('action:config.set', setting);
					logger.monitorConfig({ io: index.server }, setting);
				}
			}
			data.type = 'config-change';
			data.uid = socket.uid;
			data.ip = socket.ip;
			events.log(data, next);
		},
	], callback);
};

SocketAdmin.config.remove = (socket, key, callback) => {
	meta.configs.remove(key, callback);
};

SocketAdmin.settings.get = (socket, data, callback) => {
	meta.settings.get(data.hash, callback);
};

SocketAdmin.settings.set = (socket, data, callback) => {
	async.waterfall([
		(next) => {
			meta.settings.set(data.hash, data.values, next);
		},
		(next) => {
			var eventData = data.values;
			eventData.type = 'settings-change';
			eventData.uid = socket.uid;
			eventData.ip = socket.ip;
			eventData.hash = data.hash;
			events.log(eventData, next);
		},
	], callback);
};

SocketAdmin.settings.clearSitemapCache = (socket, data, callback) => {
	require('../sitemap').clearCache();
	callback();
};

SocketAdmin.email.test = (socket, data, callback) => {
	var site_title = meta.config.title || 'NodeBB';
	var payload = {
		subject: '[' + site_title + '] Test Email',
	};

	switch (data.template) {
	case 'digest':
		userDigest.execute({
			interval: 'alltime',
			subscribers: [socket.uid],
		}, callback);
		break;

	case 'banned':
		Object.assign(payload, {
			username: 'test-user',
			until: utils.toISOString(Date.now()),
			reason: 'Test Reason',
		});
		emailer.send(data.template, socket.uid, payload, callback);
		break;

	case 'welcome':
		userEmail.sendValidationEmail(socket.uid, {
			force: 1,
		}, callback);
		break;

	default:
		emailer.send(data.template, socket.uid, payload, callback);
		break;
	}
};

SocketAdmin.analytics.get = (socket, data, callback) => {
	if (!data || !data.graph || !data.units) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	// Default returns views from past 24 hours, by hour
	if (!data.amount) {
		if (data.units === 'days') {
			data.amount = 30;
		} else {
			data.amount = 24;
		}
	}

	if (data.graph === 'traffic') {
		async.parallel({
			uniqueVisitors: (next) => {
				if (data.units === 'days') {
					analytics.getDailyStatsForSet('analytics:uniquevisitors', data.until || Date.now(), data.amount, next);
				} else {
					analytics.getHourlyStatsForSet('analytics:uniquevisitors', data.until || Date.now(), data.amount, next);
				}
			},
			pageviews: (next) => {
				if (data.units === 'days') {
					analytics.getDailyStatsForSet('analytics:pageviews', data.until || Date.now(), data.amount, next);
				} else {
					analytics.getHourlyStatsForSet('analytics:pageviews', data.until || Date.now(), data.amount, next);
				}
			},
			summary: (next) => {
				analytics.getSummary(next);
			},
		}, (err, data) => {
			data.pastDay = data.pageviews.reduce((a, b) => parseInt(a, 10) + parseInt(b, 10));
			data.pageviews[data.pageviews.length - 1] = parseInt(data.pageviews[data.pageviews.length - 1], 10) + analytics.getUnwrittenPageviews();
			callback(err, data);
		});
	}
};

SocketAdmin.logs.get = (socket, data, callback) => {
	meta.logs.get(callback);
};

SocketAdmin.logs.clear = (socket, data, callback) => {
	meta.logs.clear(callback);
};

SocketAdmin.errors.clear = (socket, data, callback) => {
	meta.errors.clear(callback);
};

SocketAdmin.deleteAllEvents = (socket, data, callback) => {
	events.deleteAll(callback);
};

SocketAdmin.getSearchDict = (socket, data, callback) => {
	async.waterfall([
		(next) => {
			user.getSettings(socket.uid, next);
		},
		(settings, next) => {
			var lang = settings.userLang || meta.config.defaultLang || 'en-GB';
			getAdminSearchDict(lang, next);
		},
	], callback);
};

SocketAdmin.deleteAllSessions = (socket, data, callback) => {
	user.auth.deleteAllSessions(callback);
};

SocketAdmin.reloadAllSessions = (socket, data, callback) => {
	websockets.in('uid_' + socket.uid).emit('event:livereload');
	callback();
};

module.exports = SocketAdmin;
