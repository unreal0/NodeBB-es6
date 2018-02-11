var async = require('async');
var validator = require('validator');

var db = require('../database');
var user = require('../user');
var plugins = require('../plugins');

module.exports = (Messaging) => {
	Messaging.getRoomData = (roomId, callback) => {
		async.waterfall([
			(next) => {
				db.getObject('chat:room:' + roomId, next);
			},
			(data, next) => {
				if (!data) {
					return callback(new Error('[[error:no-chat-room]]'));
				}
				modifyRoomData([data]);
				next(null, data);
			},
		], callback);
	};

	Messaging.getRoomsData = (roomIds, callback) => {
		var keys = roomIds.map(roomId => 'chat:room:' + roomId);
		async.waterfall([
			(next) => {
				db.getObjects(keys, next);
			},
			(roomData, next) => {
				modifyRoomData(roomData);
				next(null, roomData);
			},
		], callback);
	};

	function modifyRoomData(rooms) {
		rooms.forEach((data) => {
			if (data) {
				data.roomName = data.roomName || '';
				data.roomName = validator.escape(String(data.roomName));
				if (data.hasOwnProperty('groupChat')) {
					data.groupChat = parseInt(data.groupChat, 10) === 1;
				}
			}
		});
	}

	Messaging.newRoom = (uid, toUids, callback) => {
		var roomId;
		var now = Date.now();
		async.waterfall([
			(next) => {
				db.incrObjectField('global', 'nextChatRoomId', next);
			},
			(_roomId, next) => {
				roomId = _roomId;
				var room = {
					owner: uid,
					roomId: roomId,
				};
				db.setObject('chat:room:' + roomId, room, next);
			},
			(next) => {
				db.sortedSetAdd('chat:room:' + roomId + ':uids', now, uid, next);
			},
			(next) => {
				Messaging.addUsersToRoom(uid, toUids, roomId, next);
			},
			(next) => {
				Messaging.addRoomToUsers(roomId, [uid].concat(toUids), now, next);
			},
			(next) => {
				next(null, roomId);
			},
		], callback);
	};

	Messaging.isUserInRoom = (uid, roomId, callback) => {
		async.waterfall([
			(next) => {
				db.isSortedSetMember('chat:room:' + roomId + ':uids', uid, next);
			},
			(inRoom, next) => {
				plugins.fireHook('filter:messaging.isUserInRoom', { uid: uid, roomId: roomId, inRoom: inRoom }, next);
			},
			(data, next) => {
				next(null, data.inRoom);
			},
		], callback);
	};

	Messaging.roomExists = (roomId, callback) => {
		db.exists('chat:room:' + roomId + ':uids', callback);
	};

	Messaging.getUserCountInRoom = (roomId, callback) => {
		db.sortedSetCard('chat:room:' + roomId + ':uids', callback);
	};

	Messaging.isRoomOwner = (uid, roomId, callback) => {
		async.waterfall([
			(next) => {
				db.getObjectField('chat:room:' + roomId, 'owner', next);
			},
			(owner, next) => {
				next(null, parseInt(uid, 10) === parseInt(owner, 10));
			},
		], callback);
	};

	Messaging.addUsersToRoom = (uid, uids, roomId, callback) => {
		async.waterfall([
			(next) => {
				Messaging.isUserInRoom(uid, roomId, next);
			},
			(inRoom, next) => {
				if (!inRoom) {
					return next(new Error('[[error:cant-add-users-to-chat-room]]'));
				}
				var now = Date.now();
				var timestamps = uids.map(() => now);
				db.sortedSetAdd('chat:room:' + roomId + ':uids', timestamps, uids, next);
			},
			(next) => {
				async.parallel({
					userCount: async.apply(db.sortedSetCard, 'chat:room:' + roomId + ':uids'),
					roomData: async.apply(db.getObject, 'chat:room:' + roomId),
				}, next);
			},
			(results, next) => {
				if (!results.roomData.hasOwnProperty('groupChat') && results.userCount > 2) {
					return db.setObjectField('chat:room:' + roomId, 'groupChat', 1, next);
				}
				next();
			},
		], callback);
	};

	Messaging.removeUsersFromRoom = (uid, uids, roomId, callback) => {
		async.waterfall([
			(next) => {
				async.parallel({
					isOwner: async.apply(Messaging.isRoomOwner, uid, roomId),
					userCount: async.apply(Messaging.getUserCountInRoom, roomId),
				}, next);
			},
			(results, next) => {
				if (!results.isOwner) {
					return next(new Error('[[error:cant-remove-users-from-chat-room]]'));
				}
				if (results.userCount === 2) {
					return next(new Error('[[error:cant-remove-last-user]]'));
				}
				Messaging.leaveRoom(uids, roomId, next);
			},
		], callback);
	};

	Messaging.leaveRoom = (uids, roomId, callback) => {
		async.waterfall([
			(next) => {
				db.sortedSetRemove('chat:room:' + roomId + ':uids', uids, next);
			},
			(next) => {
				var keys = uids.map(uid => 'uid:' + uid + ':chat:rooms');
				keys = keys.concat(uids.map(uid => 'uid:' + uid + ':chat:rooms:unread'));
				db.sortedSetsRemove(keys, roomId, next);
			},
		], callback);
	};

	Messaging.getUidsInRoom = (roomId, start, stop, callback) => {
		db.getSortedSetRevRange('chat:room:' + roomId + ':uids', start, stop, callback);
	};

	Messaging.getUsersInRoom = (roomId, start, stop, callback) => {
		async.waterfall([
			(next) => {
				Messaging.getUidsInRoom(roomId, start, stop, next);
			},
			(uids, next) => {
				user.getUsersFields(uids, ['uid', 'username', 'picture', 'status'], next);
			},
		], callback);
	};

	Messaging.renameRoom = (uid, roomId, newName, callback) => {
		if (!newName) {
			return callback(new Error('[[error:invalid-name]]'));
		}
		newName = newName.trim();
		if (newName.length > 75) {
			return callback(new Error('[[error:chat-room-name-too-long]]'));
		}
		async.waterfall([
			(next) => {
				Messaging.isRoomOwner(uid, roomId, next);
			},
			(isOwner, next) => {
				if (!isOwner) {
					return next(new Error('[[error:no-privileges]]'));
				}
				db.setObjectField('chat:room:' + roomId, 'roomName', newName, next);
			},
		], callback);
	};

	Messaging.canReply = (roomId, uid, callback) => {
		async.waterfall([
			(next) => {
				db.isSortedSetMember('chat:room:' + roomId + ':uids', uid, next);
			},
			(inRoom, next) => {
				plugins.fireHook('filter:messaging.canReply', { uid: uid, roomId: roomId, inRoom: inRoom, canReply: inRoom }, next);
			},
			(data, next) => {
				next(null, data.canReply);
			},
		], callback);
	};
};
