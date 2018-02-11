var async = require('async');
var winston = require('winston');

var db = require('../database');
var meta = require('../meta');
var notifications = require('../notifications');
var privileges = require('../privileges');
var utils = require('../utils');

var UserNotifications = module.exports;

UserNotifications.get = (uid, callback) => {
	if (!parseInt(uid, 10)) {
		return callback(null, { read: [], unread: [] });
	}
	async.waterfall([
		(next) => {
			getNotifications(uid, 0, 9, next);
		},
		(notifications, next) => {
			notifications.read = notifications.read.filter(Boolean);
			notifications.unread = notifications.unread.filter(Boolean);

			var maxNotifs = 15;
			if (notifications.read.length + notifications.unread.length > maxNotifs) {
				notifications.read.length = maxNotifs - notifications.unread.length;
			}

			next(null, notifications);
		},
	], callback);
};

function filterNotifications(nids, filter, callback) {
	if (!filter) {
		return setImmediate(callback, null, nids);
	}
	async.waterfall([
		(next) => {
			var keys = nids.map(nid => ('notifications:' + nid));
			db.getObjectsFields(keys, ['nid', 'type'], next);
		},
		(notifications, next) => {
			nids = notifications.filter(notification => notification && notification.nid && notification.type === filter).map(notification => notification.nid);
			next(null, nids);
		},
	], callback);
}

UserNotifications.getAll = (uid, filter, callback) => {
	var nids;
	async.waterfall([
		(next) => {
			async.parallel({
				unread: (next) => {
					db.getSortedSetRevRange('uid:' + uid + ':notifications:unread', 0, -1, next);
				},
				read: (next) => {
					db.getSortedSetRevRange('uid:' + uid + ':notifications:read', 0, -1, next);
				},
			}, next);
		},
		(results, next) => {
			nids = results.unread.concat(results.read);
			db.isSortedSetMembers('notifications', nids, next);
		},
		(exists, next) => {
			var deleteNids = [];

			nids = nids.filter((nid, index) => {
				if (!nid || !exists[index]) {
					deleteNids.push(nid);
				}
				return nid && exists[index];
			});

			deleteUserNids(deleteNids, uid, next);
		},
		(next) => {
			filterNotifications(nids, filter, next);
		},
	], callback);
};

function deleteUserNids(nids, uid, callback) {
	callback = callback || function () {};
	if (!nids.length) {
		return setImmediate(callback);
	}
	async.parallel([
		(next) => {
			db.sortedSetRemove('uid:' + uid + ':notifications:read', nids, next);
		},
		(next) => {
			db.sortedSetRemove('uid:' + uid + ':notifications:unread', nids, next);
		},
	], (err) => {
		callback(err);
	});
}

function getNotifications(uid, start, stop, callback) {
	async.parallel({
		unread: (next) => {
			getNotificationsFromSet('uid:' + uid + ':notifications:unread', false, uid, start, stop, next);
		},
		read: (next) => {
			getNotificationsFromSet('uid:' + uid + ':notifications:read', true, uid, start, stop, next);
		},
	}, callback);
}

function getNotificationsFromSet(set, read, uid, start, stop, callback) {
	async.waterfall([
		(next) => {
			db.getSortedSetRevRange(set, start, stop, next);
		},
		(nids, next) => {
			UserNotifications.getNotifications(nids, uid, next);
		},
	], callback);
}

UserNotifications.getNotifications = (nids, uid, callback) => {
	if (!Array.isArray(nids) || !nids.length) {
		return callback(null, []);
	}

	var notificationData = [];
	async.waterfall([
		(next) => {
			async.parallel({
				notifications: (next) => {
					notifications.getMultiple(nids, next);
				},
				hasRead: (next) => {
					db.isSortedSetMembers('uid:' + uid + ':notifications:read', nids, next);
				},
			}, next);
		},
		(results, next) => {
			var deletedNids = [];
			notificationData = results.notifications.filter((notification, index) => {
				if (!notification || !notification.nid) {
					deletedNids.push(nids[index]);
				}
				if (notification) {
					notification.read = results.hasRead[index];
					notification.readClass = !notification.read ? 'unread' : '';
				}

				return notification && notification.path;
			});

			deleteUserNids(deletedNids, uid, next);
		},
		(next) => {
			notifications.merge(notificationData, next);
		},
	], callback);
};

UserNotifications.getDailyUnread = (uid, callback) => {
	var yesterday = Date.now() - (1000 * 60 * 60 * 24);	// Approximate, can be more or less depending on time changes, makes no difference really.

	async.waterfall([
		(next) => {
			db.getSortedSetRevRangeByScore('uid:' + uid + ':notifications:unread', 0, 20, '+inf', yesterday, next);
		},
		(nids, next) => {
			UserNotifications.getNotifications(nids, uid, next);
		},
	], callback);
};

UserNotifications.getUnreadCount = (uid, callback) => {
	if (!parseInt(uid, 10)) {
		return callback(null, 0);
	}

	async.waterfall([
		(next) => {
			db.getSortedSetRevRange('uid:' + uid + ':notifications:unread', 0, 99, next);
		},
		(nids, next) => {
			notifications.filterExists(nids, next);
		},
		(nids, next) => {
			var keys = nids.map(nid => 'notifications:' + nid);

			db.getObjectsFields(keys, ['mergeId'], next);
		},
		(mergeIds, next) => {
			// Collapse any notifications with identical mergeIds
			mergeIds = mergeIds.map(set => set.mergeId);

			next(null, mergeIds.reduce((count, mergeId, idx, arr) => {
				// A missing (null) mergeId means that notification is counted separately.
				if (mergeId === null || idx === arr.indexOf(mergeId)) {
					count += 1;
				}

				return count;
			}, 0));
		},
	], callback);
};

UserNotifications.getUnreadByField = (uid, field, values, callback) => {
	var nids;
	async.waterfall([
		(next) => {
			db.getSortedSetRevRange('uid:' + uid + ':notifications:unread', 0, 99, next);
		},
		(_nids, next) => {
			nids = _nids;
			if (!nids.length) {
				return callback(null, []);
			}

			var keys = nids.map(nid => 'notifications:' + nid);

			db.getObjectsFields(keys, ['nid', field], next);
		},
		(notifications, next) => {
			values = values.map(() => values.toString());
			nids = notifications.filter(notification => notification && notification[field] && values.indexOf(notification[field].toString()) !== -1).map(notification => notification.nid);

			next(null, nids);
		},
	], callback);
};

UserNotifications.deleteAll = (uid, callback) => {
	if (!parseInt(uid, 10)) {
		return callback();
	}
	async.parallel([
		(next) => {
			db.delete('uid:' + uid + ':notifications:unread', next);
		},
		(next) => {
			db.delete('uid:' + uid + ':notifications:read', next);
		},
	], callback);
};

UserNotifications.sendTopicNotificationToFollowers = (uid, topicData, postData) => {
	var followers;
	async.waterfall([
		(next) => {
			db.getSortedSetRange('followers:' + uid, 0, -1, next);
		},
		(followers, next) => {
			privileges.categories.filterUids('read', topicData.cid, followers, next);
		},
		(_followers, next) => {
			followers = _followers;
			if (!followers.length) {
				return;
			}

			var title = topicData.title;
			if (title) {
				title = utils.decodeHTMLEntities(title);
			}

			notifications.create({
				type: 'new-topic',
				bodyShort: '[[notifications:user_posted_topic, ' + postData.user.username + ', ' + title + ']]',
				bodyLong: postData.content,
				pid: postData.pid,
				path: '/post/' + postData.pid,
				nid: 'tid:' + postData.tid + ':uid:' + uid,
				tid: postData.tid,
				from: uid,
			}, next);
		},
	], (err, notification) => {
		if (err) {
			return winston.error(err);
		}

		if (notification) {
			notifications.push(notification, followers);
		}
	});
};

UserNotifications.sendWelcomeNotification = (uid, callback) => {
	callback = callback || function () {};
	if (!meta.config.welcomeNotification) {
		return callback();
	}

	var path = meta.config.welcomeLink ? meta.config.welcomeLink : '#';

	async.waterfall([
		(next) => {
			notifications.create({
				bodyShort: meta.config.welcomeNotification,
				path: path,
				nid: 'welcome_' + uid,
				from: meta.config.welcomeUid ? meta.config.welcomeUid : null,
			}, next);
		},
		(notification, next) => {
			if (!notification) {
				return next();
			}
			notifications.push(notification, [uid], next);
		},
	], callback);
};

UserNotifications.sendNameChangeNotification = (uid, username) => {
	notifications.create({
		bodyShort: '[[user:username_taken_workaround, ' + username + ']]',
		image: 'brand:logo',
		nid: 'username_taken:' + uid,
		datetime: Date.now(),
	}, (err, notification) => {
		if (!err && notification) {
			notifications.push(notification, uid);
		}
	});
};

UserNotifications.pushCount = (uid) => {
	var websockets = require('./../socket.io');
	UserNotifications.getUnreadCount(uid, (err, count) => {
		if (err) {
			return winston.error(err.stack);
		}

		websockets.in('uid_' + uid).emit('event:notifications.updateCount', count);
	});
};
