var async = require('async');

var db = require('../database');
var topics = require('../topics');
var plugins = require('../plugins');

module.exports = (User) => {
	User.updateLastOnlineTime = (uid, callback) => {
		callback = callback || function () {};
		db.getObjectFields('user:' + uid, ['status', 'lastonline'], (err, userData) => {
			var now = Date.now();
			if (err || userData.status === 'offline' || now - parseInt(userData.lastonline, 10) < 300000) {
				return callback(err);
			}
			User.setUserField(uid, 'lastonline', now, callback);
		});
	};

	User.updateOnlineUsers = (uid, callback) => {
		callback = callback || function () {};

		var now = Date.now();
		async.waterfall([
			(next) => {
				db.sortedSetScore('users:online', uid, next);
			},
			(userOnlineTime, next) => {
				if (now - parseInt(userOnlineTime, 10) < 300000) {
					return callback();
				}
				db.sortedSetAdd('users:online', now, uid, next);
			},
			(next) => {
				topics.pushUnreadCount(uid);
				plugins.fireHook('action:user.online', { uid: uid, timestamp: now });
				next();
			},
		], callback);
	};

	User.isOnline = (uid, callback) => {
		var now = Date.now();
		async.waterfall([
			(next) => {
				if (Array.isArray(uid)) {
					db.sortedSetScores('users:online', uid, next);
				} else {
					db.sortedSetScore('users:online', uid, next);
				}
			},
			(lastonline, next) => {
				function checkOnline(lastonline) {
					return now - lastonline < 300000;
				}

				var isOnline;
				if (Array.isArray(uid)) {
					isOnline = uid.map((uid, index) => (checkOnline(lastonline[index])));
				} else {
					isOnline = checkOnline(lastonline);
				}
				next(null, isOnline);
			},
		], callback);
	};
};
