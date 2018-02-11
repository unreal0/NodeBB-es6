var async = require('async');

var user = require('../user');
var notifications = require('../notifications');
var SocketNotifs = module.exports;

SocketNotifs.get = (socket, data, callback) => {
	if (data && Array.isArray(data.nids) && socket.uid) {
		user.notifications.getNotifications(data.nids, socket.uid, callback);
	} else {
		user.notifications.get(socket.uid, callback);
	}
};

SocketNotifs.getCount = (socket, data, callback) => {
	user.notifications.getUnreadCount(socket.uid, callback);
};

SocketNotifs.deleteAll = (socket, data, callback) => {
	if (!socket.uid) {
		return callback(new Error('[[error:no-privileges]]'));
	}

	user.notifications.deleteAll(socket.uid, callback);
};

SocketNotifs.markRead = (socket, nid, callback) => {
	async.waterfall([
		(next) => {
			notifications.markRead(nid, socket.uid, next);
		},
		(next) => {
			user.notifications.pushCount(socket.uid);
			next();
		},
	], callback);
};

SocketNotifs.markUnread = (socket, nid, callback) => {
	async.waterfall([
		(next) => {
			notifications.markUnread(nid, socket.uid, next);
		},
		(next) => {
			user.notifications.pushCount(socket.uid);
			next();
		},
	], callback);
};

SocketNotifs.markAllRead = (socket, data, callback) => {
	async.waterfall([
		(next) => {
			notifications.markAllRead(socket.uid, next);
		},
		(next) => {
			user.notifications.pushCount(socket.uid);
			next();
		},
	], callback);
};
