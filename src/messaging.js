var async = require('async');
var validator = require('validator');

var db = require('./database');
var user = require('./user');
var plugins = require('./plugins');
var meta = require('./meta');
var utils = require('./utils');

var Messaging = module.exports;

require('./messaging/data')(Messaging);
require('./messaging/create')(Messaging);
require('./messaging/delete')(Messaging);
require('./messaging/edit')(Messaging);
require('./messaging/rooms')(Messaging);
require('./messaging/unread')(Messaging);
require('./messaging/notifications')(Messaging);


Messaging.getMessages = (params, callback) => {
	var uid = params.uid;
	var roomId = params.roomId;
	var isNew = params.isNew || false;
	var start = params.hasOwnProperty('start') ? params.start : 0;
	var stop = parseInt(start, 10) + ((params.count || 50) - 1);

	var indices = {};
	async.waterfall([
		(next) => {
			canGet('filter:messaging.canGetMessages', params.callerUid, params.uid, next);
		},
		(canGet, next) => {
			if (!canGet) {
				return callback(null, null);
			}
			db.getSortedSetRevRange('uid:' + uid + ':chat:room:' + roomId + ':mids', start, stop, next);
		},
		(mids, next) => {
			if (!mids.length) {
				return callback(null, []);
			}

			mids.forEach((mid, index) => {
				indices[mid] = start + index;
			});

			mids.reverse();

			Messaging.getMessagesData(mids, uid, roomId, isNew, next);
		},
		(messageData, next) => {
			messageData.forEach((messageData) => {
				messageData.index = indices[messageData.messageId.toString()];
			});
			next(null, messageData);
		},
	], callback);
};

function canGet(hook, callerUid, uid, callback) {
	plugins.fireHook(hook, {
		callerUid: callerUid,
		uid: uid,
		canGet: parseInt(callerUid, 10) === parseInt(uid, 10),
	}, (err, data) => {
		callback(err, data ? data.canGet : false);
	});
}

Messaging.parse = (message, fromuid, uid, roomId, isNew, callback) => {
	message = utils.decodeHTMLEntities(utils.stripHTMLTags(message));
	message = validator.escape(String(message));

	plugins.fireHook('filter:parse.raw', message, (err, parsed) => {
		if (err) {
			return callback(err);
		}


		var messageData = {
			message: message,
			parsed: parsed,
			fromuid: fromuid,
			uid: uid,
			roomId: roomId,
			isNew: isNew,
			parsedMessage: parsed,
		};

		plugins.fireHook('filter:messaging.parse', messageData, (err, messageData) => {
			callback(err, messageData ? messageData.parsedMessage : '');
		});
	});
};

Messaging.isNewSet = (uid, roomId, timestamp, callback) => {
	var setKey = 'uid:' + uid + ':chat:room:' + roomId + ':mids';

	async.waterfall([
		(next) => {
			db.getSortedSetRevRangeWithScores(setKey, 0, 0, next);
		},
		(messages, next) => {
			if (messages && messages.length) {
				next(null, parseInt(timestamp, 10) > parseInt(messages[0].score, 10) + Messaging.newMessageCutoff);
			} else {
				next(null, true);
			}
		},
	], callback);
};


Messaging.getRecentChats = (callerUid, uid, start, stop, callback) => {
	async.waterfall([
		(next) => {
			canGet('filter:messaging.canGetRecentChats', callerUid, uid, next);
		},
		(canGet, next) => {
			if (!canGet) {
				return callback(null, null);
			}
			db.getSortedSetRevRange('uid:' + uid + ':chat:rooms', start, stop, next);
		},
		(roomIds, next) => {
			async.parallel({
				roomData: (next) => {
					Messaging.getRoomsData(roomIds, next);
				},
				unread: (next) => {
					db.isSortedSetMembers('uid:' + uid + ':chat:rooms:unread', roomIds, next);
				},
				users: (next) => {
					async.map(roomIds, (roomId, next) => {
						db.getSortedSetRevRange('chat:room:' + roomId + ':uids', 0, 9, (err, uids) => {
							if (err) {
								return next(err);
							}
							uids = uids.filter(value => value && parseInt(value, 10) !== parseInt(uid, 10));
							user.getUsersFields(uids, ['uid', 'username', 'userslug', 'picture', 'status', 'lastonline'], next);
						});
					}, next);
				},
				teasers: (next) => {
					async.map(roomIds, (roomId, next) => {
						Messaging.getTeaser(uid, roomId, next);
					}, next);
				},
			}, next);
		},
		(results, next) => {
			results.roomData.forEach((room, index) => {
				if (room) {
					room.users = results.users[index];
					room.groupChat = room.hasOwnProperty('groupChat') ? room.groupChat : room.users.length > 2;
					room.unread = results.unread[index];
					room.teaser = results.teasers[index];

					room.users.forEach((userData) => {
						if (userData && parseInt(userData.uid, 10)) {
							userData.status = user.getStatus(userData);
						}
					});
					room.users = room.users.filter(user => user && parseInt(user.uid, 10));
					room.lastUser = room.users[0];

					room.usernames = Messaging.generateUsernames(room.users, uid);
				}
			});

			results.roomData = results.roomData.filter(Boolean);

			next(null, { rooms: results.roomData, nextStart: stop + 1 });
		},
		(ref, next) => {
			plugins.fireHook('filter:messaging.getRecentChats', {
				rooms: ref.rooms,
				nextStart: ref.nextStart,
				uid: uid,
				callerUid: callerUid,
			}, next);
		},
	], callback);
};

Messaging.generateUsernames = (users, excludeUid) => {
	users = users.filter(user => user && parseInt(user.uid, 10) !== excludeUid);
	return users.map(user => user.username).join(', ');
};

Messaging.getTeaser = (uid, roomId, callback) => {
	var teaser;
	async.waterfall([
		(next) => {
			db.getSortedSetRevRange('uid:' + uid + ':chat:room:' + roomId + ':mids', 0, 0, next);
		},
		(mids, next) => {
			if (!mids || !mids.length) {
				return next(null, null);
			}
			Messaging.getMessageFields(mids[0], ['fromuid', 'content', 'timestamp'], next);
		},
		(_teaser, next) => {
			teaser = _teaser;
			if (!teaser) {
				return callback();
			}
			if (teaser.content) {
				teaser.content = utils.stripHTMLTags(utils.decodeHTMLEntities(teaser.content));
				teaser.content = validator.escape(String(teaser.content));
			}

			teaser.timestampISO = utils.toISOString(teaser.timestamp);
			user.getUserFields(teaser.fromuid, ['uid', 'username', 'userslug', 'picture', 'status', 'lastonline'], next);
		},
		(user, next) => {
			teaser.user = user;
			plugins.fireHook('filter:messaging.getTeaser', { teaser: teaser }, (err, data) => {
				next(err, data.teaser);
			});
		},
	], callback);
};

Messaging.canMessageUser = (uid, toUid, callback) => {
	if (parseInt(meta.config.disableChat, 10) === 1 || !uid || uid === toUid) {
		return callback(new Error('[[error:chat-disabled]]'));
	}

	if (parseInt(uid, 10) === parseInt(toUid, 10)) {
		return callback(new Error('[[error:cant-chat-with-yourself'));
	}

	async.waterfall([
		(next) => {
			user.exists(toUid, next);
		},
		(exists, next) => {
			if (!exists) {
				return callback(new Error('[[error:no-user]]'));
			}
			user.getUserFields(uid, ['banned', 'email:confirmed'], next);
		},
		(userData, next) => {
			if (parseInt(userData.banned, 10) === 1) {
				return callback(new Error('[[error:user-banned]]'));
			}

			if (parseInt(meta.config.requireEmailConfirmation, 10) === 1 && parseInt(userData['email:confirmed'], 10) !== 1) {
				return callback(new Error('[[error:email-not-confirmed-chat]]'));
			}

			async.parallel({
				settings: async.apply(user.getSettings, toUid),
				isAdmin: async.apply(user.isAdministrator, uid),
				isFollowing: async.apply(user.isFollowing, toUid, uid),
			}, next);
		},
		(results, next) => {
			if (results.settings.restrictChat && !results.isAdmin && !results.isFollowing) {
				return next(new Error('[[error:chat-restricted]]'));
			}

			plugins.fireHook('static:messaging.canMessageUser', {
				uid: uid,
				toUid: toUid,
			}, (err) => {
				next(err);
			});
		},
	], callback);
};

Messaging.canMessageRoom = (uid, roomId, callback) => {
	if (parseInt(meta.config.disableChat, 10) === 1 || !uid) {
		return callback(new Error('[[error:chat-disabled]]'));
	}

	async.waterfall([
		(next) => {
			Messaging.isUserInRoom(uid, roomId, next);
		},
		(inRoom, next) => {
			if (!inRoom) {
				return next(new Error('[[error:not-in-room]]'));
			}

			Messaging.getUserCountInRoom(roomId, next);
		},
		(count, next) => {
			if (count < 2) {
				return next(new Error('[[error:no-users-in-room]]'));
			}

			user.getUserFields(uid, ['banned', 'email:confirmed'], next);
		},
		(userData, next) => {
			if (parseInt(userData.banned, 10) === 1) {
				return next(new Error('[[error:user-banned]]'));
			}

			if (parseInt(meta.config.requireEmailConfirmation, 10) === 1 && parseInt(userData['email:confirmed'], 10) !== 1) {
				return next(new Error('[[error:email-not-confirmed-chat]]'));
			}

			plugins.fireHook('static:messaging.canMessageRoom', {
				uid: uid,
				roomId: roomId,
			}, (err) => {
				next(err);
			});
		},
	], callback);
};

Messaging.hasPrivateChat = (uid, withUid, callback) => {
	if (parseInt(uid, 10) === parseInt(withUid, 10)) {
		return callback(null, 0);
	}
	async.waterfall([
		(next) => {
			async.parallel({
				myRooms: async.apply(db.getSortedSetRevRange, 'uid:' + uid + ':chat:rooms', 0, -1),
				theirRooms: async.apply(db.getSortedSetRevRange, 'uid:' + withUid + ':chat:rooms', 0, -1),
			}, next);
		},
		(results, next) => {
			var roomIds = results.myRooms.filter(roomId => roomId && results.theirRooms.indexOf(roomId) !== -1);

			if (!roomIds.length) {
				return callback();
			}

			var index = 0;
			var roomId = 0;
			async.whilst(() => index < roomIds.length && !roomId, (next) => {
				Messaging.getUserCountInRoom(roomIds[index], (err, count) => {
					if (err) {
						return next(err);
					}
					if (count === 2) {
						roomId = roomIds[index];
						next(null, roomId);
					} else {
						index += 1;
						next();
					}
				});
			}, (err) => {
				next(err, roomId);
			});
		},
	], callback);
};
