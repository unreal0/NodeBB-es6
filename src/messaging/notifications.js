var async = require('async');

var user = require('../user');
var notifications = require('../notifications');
var sockets = require('../socket.io');
var plugins = require('../plugins');

module.exports = (Messaging) => {
	Messaging.notifyQueue = {};	// Only used to notify a user of a new chat message, see Messaging.notifyUser

	Messaging.notificationSendDelay = 1000 * 60;

	Messaging.notifyUsersInRoom = (fromUid, roomId, messageObj) => {
		async.waterfall([
			(next) => {
				Messaging.getUidsInRoom(roomId, 0, -1, next);
			},
			(uids, next) => {
				var data = {
					roomId: roomId,
					fromUid: fromUid,
					message: messageObj,
					uids: uids,
				};

				plugins.fireHook('filter:messaging.notify', data, next);
			},
			(data, next) => {
				if (!data || !data.uids || !data.uids.length) {
					return next();
				}

				var uids = data.uids;

				uids.forEach((uid) => {
					data.self = parseInt(uid, 10) === parseInt(fromUid, 10) ? 1 : 0;
					Messaging.pushUnreadCount(uid);
					sockets.in('uid_' + uid).emit('event:chats.receive', data);
				});

				// Delayed notifications
				var queueObj = Messaging.notifyQueue[fromUid + ':' + roomId];
				if (queueObj) {
					queueObj.message.content += '\n' + messageObj.content;
					clearTimeout(queueObj.timeout);
				} else {
					queueObj = {
						message: messageObj,
					};
					Messaging.notifyQueue[fromUid + ':' + roomId] = queueObj;
				}

				queueObj.timeout = setTimeout(() => {
					sendNotifications(fromUid, uids, roomId, queueObj.message);
				}, Messaging.notificationSendDelay);
				next();
			},
		]);
	};

	function sendNotifications(fromuid, uids, roomId, messageObj) {
		async.waterfall([
			(next) => {
				user.isOnline(uids, next);
			},
			(isOnline, next) => {
				uids = uids.filter((uid, index) => !isOnline[index] && parseInt(fromuid, 10) !== parseInt(uid, 10));

				if (!uids.length) {
					return;
				}

				notifications.create({
					type: 'new-chat',
					subject: '[[email:notif.chat.subject, ' + messageObj.fromUser.username + ']]',
					bodyShort: '[[notifications:new_message_from, ' + messageObj.fromUser.username + ']]',
					bodyLong: messageObj.content,
					nid: 'chat_' + fromuid + '_' + roomId,
					from: fromuid,
					path: '/chats/' + messageObj.roomId,
				}, next);
			},
		], (err, notification) => {
			if (!err) {
				delete Messaging.notifyQueue[fromuid + ':' + roomId];
				if (notification) {
					notifications.push(notification, uids);
				}
			}
		});
	}
};
