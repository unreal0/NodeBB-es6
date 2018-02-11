var async = require('async');

var user = require('../../user');
var topics = require('../../topics');

module.exports = (SocketTopics) => {
	SocketTopics.markAsRead = (socket, tids, callback) => {
		if (!Array.isArray(tids) || !socket.uid) {
			return callback(new Error('[[error:invalid-data]]'));
		}
		async.waterfall([
			(next) => {
				topics.markAsRead(tids, socket.uid, next);
			},
			(hasMarked, next) => {
				if (hasMarked) {
					topics.pushUnreadCount(socket.uid);

					topics.markTopicNotificationsRead(tids, socket.uid);
				}
				next();
			},
		], callback);
	};

	SocketTopics.markTopicNotificationsRead = (socket, tids, callback) => {
		if (!Array.isArray(tids) || !socket.uid) {
			return callback(new Error('[[error:invalid-data]]'));
		}
		topics.markTopicNotificationsRead(tids, socket.uid, callback);
	};

	SocketTopics.markAllRead = (socket, data, callback) => {
		if (!socket.uid) {
			return callback(new Error('[[error:invalid-uid]]'));
		}
		async.waterfall([
			(next) => {
				topics.markAllRead(socket.uid, next);
			},
			(next) => {
				topics.pushUnreadCount(socket.uid);
				next();
			},
		], callback);
	};

	SocketTopics.markCategoryTopicsRead = (socket, cid, callback) => {
		async.waterfall([
			(next) => {
				topics.getUnreadTids({ cid: cid, uid: socket.uid, filter: '' }, next);
			},
			(tids, next) => {
				SocketTopics.markAsRead(socket, tids, next);
			},
		], callback);
	};

	SocketTopics.markUnread = (socket, tid, callback) => {
		if (!tid || !socket.uid) {
			return callback(new Error('[[error:invalid-data]]'));
		}
		async.waterfall([
			(next) => {
				topics.markUnread(tid, socket.uid, next);
			},
			(next) => {
				topics.pushUnreadCount(socket.uid);
				next();
			},
		], callback);
	};

	SocketTopics.markAsUnreadForAll = (socket, tids, callback) => {
		if (!Array.isArray(tids)) {
			return callback(new Error('[[error:invalid-tid]]'));
		}

		if (!socket.uid) {
			return callback(new Error('[[error:no-privileges]]'));
		}

		async.waterfall([
			(next) => {
				user.isAdministrator(socket.uid, next);
			},
			(isAdmin, next) => {
				async.each(tids, (tid, next) => {
					async.waterfall([
						(next) => {
							topics.exists(tid, next);
						},
						(exists, next) => {
							if (!exists) {
								return next(new Error('[[error:no-topic]]'));
							}
							topics.getTopicField(tid, 'cid', next);
						},
						(cid, next) => {
							user.isModerator(socket.uid, cid, next);
						},
						(isMod, next) => {
							if (!isAdmin && !isMod) {
								return next(new Error('[[error:no-privileges]]'));
							}
							topics.markAsUnreadForAll(tid, next);
						},
						(next) => {
							topics.updateRecent(tid, Date.now(), next);
						},
					], next);
				}, next);
			},
			(next) => {
				topics.pushUnreadCount(socket.uid);
				next();
			},
		], callback);
	};
};
