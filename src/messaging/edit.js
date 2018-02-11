var async = require('async');

var meta = require('../meta');
var user = require('../user');

var sockets = require('../socket.io');


module.exports = (Messaging) => {
	Messaging.editMessage = (uid, mid, roomId, content, callback) => {
		var uids;
		async.waterfall([
			(next) => {
				Messaging.getMessageField(mid, 'content', next);
			},
			(raw, next) => {
				if (raw === content) {
					return callback();
				}

				Messaging.setMessageFields(mid, {
					content: content,
					edited: Date.now(),
				}, next);
			},
			(next) => {
				Messaging.getUidsInRoom(roomId, 0, -1, next);
			},
			(_uids, next) => {
				uids = _uids;
				Messaging.getMessagesData([mid], uid, roomId, true, next);
			},
			(messages, next) => {
				uids.forEach((uid) => {
					sockets.in('uid_' + uid).emit('event:chats.edit', {
						messages: messages,
					});
				});
				next();
			},
		], callback);
	};

	Messaging.canEdit = (messageId, uid, callback) => {
		canEditDelete(messageId, uid, 'edit', callback);
	};

	Messaging.canDelete = (messageId, uid, callback) => {
		canEditDelete(messageId, uid, 'delete', callback);
	};

	function canEditDelete(messageId, uid, type, callback) {
		var durationConfig = '';
		if (type === 'edit') {
			durationConfig = 'chatEditDuration';
		} else if (type === 'delete') {
			durationConfig = 'chatDeleteDuration';
		}

		if (parseInt(meta.config.disableChat, 10) === 1) {
			return callback(new Error('[[error:chat-disabled]]'));
		} else if (parseInt(meta.config.disableChatMessageEditing, 10) === 1) {
			return callback(new Error('[[error:chat-message-editing-disabled]]'));
		}

		async.waterfall([
			(next) => {
				user.getUserFields(uid, ['banned', 'email:confirmed'], next);
			},
			(userData, next) => {
				if (parseInt(userData.banned, 10) === 1) {
					return callback(new Error('[[error:user-banned]]'));
				}

				if (parseInt(meta.config.requireEmailConfirmation, 10) === 1 && parseInt(userData['email:confirmed'], 10) !== 1) {
					return callback(new Error('[[error:email-not-confirmed]]'));
				}
				async.parallel({
					isAdmin: (next) => {
						user.isAdministrator(uid, next);
					},
					messageData: (next) => {
						Messaging.getMessageFields(messageId, ['fromuid', 'timestamp'], next);
					},
				}, next);
			},
			(results, next) => {
				if (results.isAdmin) {
					return callback();
				}
				var chatConfigDuration = parseInt(meta.config[durationConfig], 10);
				if (chatConfigDuration && Date.now() - parseInt(results.messageData.timestamp, 10) > chatConfigDuration * 1000) {
					return callback(new Error('[[error:chat-' + type + '-duration-expired, ' + meta.config[durationConfig] + ']]'));
				}

				if (parseInt(results.messageData.fromuid, 10) === parseInt(uid, 10)) {
					return callback();
				}

				next(new Error('[[error:cant-' + type + '-chat-message]]'));
			},
		], callback);
	}
};
