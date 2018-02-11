var async = require('async');

var db = require('../database');
var user = require('../user');
var utils = require('../utils');
var plugins = require('../plugins');

module.exports = (Messaging) => {
	Messaging.newMessageCutoff = 1000 * 60 * 3;

	Messaging.getMessageField = (mid, field, callback) => {
		Messaging.getMessageFields(mid, [field], (err, fields) => {
			callback(err, fields ? fields[field] : null);
		});
	};

	Messaging.getMessageFields = (mid, fields, callback) => {
		db.getObjectFields('message:' + mid, fields, callback);
	};

	Messaging.setMessageField = (mid, field, content, callback) => {
		db.setObjectField('message:' + mid, field, content, callback);
	};

	Messaging.setMessageFields = (mid, data, callback) => {
		db.setObject('message:' + mid, data, callback);
	};

	Messaging.getMessagesData = (mids, uid, roomId, isNew, callback) => {
		var messages;

		async.waterfall([
			(next) => {
				var keys = mids.map(mid => 'message:' + mid);

				db.getObjects(keys, next);
			},
			(_messages, next) => {
				messages = _messages.map((msg, idx) => {
					if (msg) {
						msg.messageId = parseInt(mids[idx], 10);
					}
					return msg;
				}).filter(Boolean);

				var uids = messages.map(msg => msg && msg.fromuid);

				user.getUsersFields(uids, ['uid', 'username', 'userslug', 'picture', 'status'], next);
			},
			(users, next) => {
				messages.forEach((message, index) => {
					message.fromUser = users[index];
					var self = parseInt(message.fromuid, 10) === parseInt(uid, 10);
					message.self = self ? 1 : 0;
					message.timestampISO = utils.toISOString(message.timestamp);
					message.newSet = false;
					message.roomId = String(message.roomId || roomId);
					if (message.hasOwnProperty('edited')) {
						message.editedISO = new Date(parseInt(message.edited, 10)).toISOString();
					}
				});

				async.map(messages, (message, next) => {
					Messaging.parse(message.content, message.fromuid, uid, roomId, isNew, (err, result) => {
						if (err) {
							return next(err);
						}
						message.content = result;
						message.cleanedContent = utils.stripHTMLTags(utils.decodeHTMLEntities(result));
						next(null, message);
					});
				}, next);
			},
			(messages, next) => {
				if (messages.length > 1) {
					// Add a spacer in between messages with time gaps between them
					messages = messages.map((message, index) => {
						// Compare timestamps with the previous message, and check if a spacer needs to be added
						if (index > 0 && parseInt(message.timestamp, 10) > parseInt(messages[index - 1].timestamp, 10) + Messaging.newMessageCutoff) {
							// If it's been 5 minutes, this is a new set of messages
							message.newSet = true;
						} else if (index > 0 && message.fromuid !== messages[index - 1].fromuid) {
							// If the previous message was from the other person, this is also a new set
							message.newSet = true;
						}

						return message;
					});

					next(undefined, messages);
				} else if (messages.length === 1) {
					// For single messages, we don't know the context, so look up the previous message and compare
					var key = 'uid:' + uid + ':chat:room:' + roomId + ':mids';
					async.waterfall([
						async.apply(db.sortedSetRank, key, messages[0].messageId),
						(index, next) => {
							// Continue only if this isn't the first message in sorted set
							if (index > 0) {
								db.getSortedSetRange(key, index - 1, index - 1, next);
							} else {
								messages[0].newSet = true;
								return next(undefined, messages);
							}
						},
						(mid, next) => {
							Messaging.getMessageFields(mid, ['fromuid', 'timestamp'], next);
						},
					], (err, fields) => {
						if (err) {
							return next(err);
						}

						if (
							(parseInt(messages[0].timestamp, 10) > parseInt(fields.timestamp, 10) + Messaging.newMessageCutoff) ||
							(parseInt(messages[0].fromuid, 10) !== parseInt(fields.fromuid, 10))
						) {
							// If it's been 5 minutes, this is a new set of messages
							messages[0].newSet = true;
						}

						next(undefined, messages);
					});
				} else {
					next(null, []);
				}
			},
			(messages, next) => {
				plugins.fireHook('filter:messaging.getMessages', {
					messages: messages,
					uid: uid,
					roomId: roomId,
					isNew: isNew,
					mids: mids,
				}, (err, data) => {
					next(err, data && data.messages);
				});
			},
		], callback);
	};
};
