var async = require('async');

var db = require('../database');
var sockets = require('../socket.io');

module.exports = (Messaging) => {
	Messaging.getUnreadCount = (uid, callback) => {
		if (!parseInt(uid, 10)) {
			return callback(null, 0);
		}
		db.sortedSetCard('uid:' + uid + ':chat:rooms:unread', callback);
	};

	Messaging.pushUnreadCount = (uid) => {
		if (!parseInt(uid, 10)) {
			return;
		}
		Messaging.getUnreadCount(uid, (err, unreadCount) => {
			if (err) {
				return;
			}
			sockets.in('uid_' + uid).emit('event:unread.updateChatCount', unreadCount);
		});
	};

	Messaging.markRead = (uid, roomId, callback) => {
		db.sortedSetRemove('uid:' + uid + ':chat:rooms:unread', roomId, callback);
	};

	Messaging.markAllRead = (uid, callback) => {
		db.delete('uid:' + uid + ':chat:rooms:unread', callback);
	};

	Messaging.markUnread = (uids, roomId, callback) => {
		async.waterfall([
			(next) => {
				Messaging.roomExists(roomId, next);
			},
			(exists, next) => {
				if (!exists) {
					return next(new Error('[[error:chat-room-does-not-exist]]'));
				}
				var keys = uids.map(uid => 'uid:' + uid + ':chat:rooms:unread');

				db.sortedSetsAdd(keys, Date.now(), roomId, next);
			},
		], callback);
	};
};
