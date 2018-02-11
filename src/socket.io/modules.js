var async = require('async');
var validator = require('validator');

var db = require('../database');
var meta = require('../meta');
var notifications = require('../notifications');
var plugins = require('../plugins');
var Messaging = require('../messaging');
var utils = require('../utils');
var server = require('./');
var user = require('../user');
var privileges = require('../privileges');

var SocketModules = module.exports;

SocketModules.chats = {};
SocketModules.sounds = {};
SocketModules.settings = {};

/* Chat */

SocketModules.chats.getRaw = (socket, data, callback) => {
	if (!data || !data.hasOwnProperty('mid')) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	async.waterfall([
		(next) => {
			Messaging.getMessageField(data.mid, 'roomId', next);
		},
		(roomId, next) => {
			async.parallel({
				isAdmin: (next) => {
					user.isAdministrator(socket.uid, next);
				},
				hasMessage: (next) => {
					db.isSortedSetMember('uid:' + socket.uid + ':chat:room:' + roomId + ':mids', data.mid, next);
				},
				inRoom: (next) => {
					Messaging.isUserInRoom(socket.uid, roomId, next);
				},
			}, next);
		},
		(results, next) => {
			if (!results.isAdmin && (!results.inRoom || !results.hasMessage)) {
				return next(new Error('[[error:not-allowed]]'));
			}

			Messaging.getMessageField(data.mid, 'content', next);
		},
	], callback);
};

SocketModules.chats.isDnD = (socket, uid, callback) => {
	async.waterfall([
		(next) => {
			db.getObjectField('user:' + uid, 'status', next);
		},
		(status, next) => {
			next(null, status === 'dnd');
		},
	], callback);
};

SocketModules.chats.newRoom = (socket, data, callback) => {
	if (!data) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	if (rateLimitExceeded(socket)) {
		return callback(new Error('[[error:too-many-messages]]'));
	}

	async.waterfall([
		(next) => {
			privileges.global.can('chat', socket.uid, next);
		},
		(canChat, next) => {
			if (!canChat) {
				return next(new Error('[[error:no-privileges]]'));
			}
			Messaging.canMessageUser(socket.uid, data.touid, next);
		},
		(next) => {
			Messaging.newRoom(socket.uid, [data.touid], next);
		},
	], callback);
};

SocketModules.chats.send = (socket, data, callback) => {
	if (!data || !data.roomId || !socket.uid) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	if (rateLimitExceeded(socket)) {
		return callback(new Error('[[error:too-many-messages]]'));
	}

	async.waterfall([
		(next) => {
			privileges.global.can('chat', socket.uid, next);
		},
		(canChat, next) => {
			if (!canChat) {
				return next(new Error('[[error:no-privileges]]'));
			}

			plugins.fireHook('filter:messaging.send', {
				data: data,
				uid: socket.uid,
			}, (err, results) => {
				data = results.data;
				next(err);
			});
		},
		(next) => {
			Messaging.canMessageRoom(socket.uid, data.roomId, next);
		},
		(next) => {
			Messaging.sendMessage(socket.uid, data.roomId, data.message, Date.now(), next);
		},
		(message, next) => {
			Messaging.notifyUsersInRoom(socket.uid, data.roomId, message);
			user.updateOnlineUsers(socket.uid);
			next(null, message);
		},
	], callback);
};

function rateLimitExceeded(socket) {
	var now = Date.now();
	socket.lastChatMessageTime = socket.lastChatMessageTime || 0;
	var delay = meta.config.hasOwnProperty('chatMessageDelay') ? parseInt(meta.config.chatMessageDelay, 10) : 200;
	if (now - socket.lastChatMessageTime < delay) {
		return true;
	}
	socket.lastChatMessageTime = now;

	return false;
}

SocketModules.chats.loadRoom = (socket, data, callback) => {
	if (!data || !data.roomId) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	async.waterfall([
		(next) => {
			privileges.global.can('chat', socket.uid, next);
		},
		(canChat, next) => {
			if (!canChat) {
				return next(new Error('[[error:no-privileges]]'));
			}

			Messaging.isUserInRoom(socket.uid, data.roomId, next);
		},
		(inRoom, next) => {
			if (!inRoom) {
				return next(new Error('[[error:not-allowed]]'));
			}

			async.parallel({
				roomData: async.apply(Messaging.getRoomData, data.roomId),
				canReply: async.apply(Messaging.canReply, data.roomId, socket.uid),
				users: async.apply(Messaging.getUsersInRoom, data.roomId, 0, -1),
				messages: async.apply(Messaging.getMessages, {
					callerUid: socket.uid,
					uid: data.uid || socket.uid,
					roomId: data.roomId,
					isNew: false,
				}),
			}, next);
		},
		(results, next) => {
			results.roomData.users = results.users;
			results.roomData.canReply = results.canReply;
			results.roomData.usernames = Messaging.generateUsernames(results.users, socket.uid);
			results.roomData.messages = results.messages;
			results.roomData.groupChat = results.roomData.hasOwnProperty('groupChat') ? results.roomData.groupChat : results.users.length > 2;
			results.roomData.isOwner = parseInt(results.roomData.owner, 10) === socket.uid;
			results.roomData.maximumUsersInChatRoom = parseInt(meta.config.maximumUsersInChatRoom, 10) || 0;
			results.roomData.maximumChatMessageLength = parseInt(meta.config.maximumChatMessageLength, 10) || 1000;
			results.roomData.showUserInput = !results.roomData.maximumUsersInChatRoom || results.roomData.maximumUsersInChatRoom > 2;
			next(null, results.roomData);
		},
	], callback);
};

SocketModules.chats.addUserToRoom = (socket, data, callback) => {
	if (!data || !data.roomId || !data.username) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	var uid;
	async.waterfall([
		(next) => {
			privileges.global.can('chat', socket.uid, next);
		},
		(canChat, next) => {
			if (!canChat) {
				return next(new Error('[[error:no-privileges]]'));
			}

			Messaging.getUserCountInRoom(data.roomId, next);
		},
		(userCount, next) => {
			var maxUsers = parseInt(meta.config.maximumUsersInChatRoom, 10) || 0;
			if (maxUsers && userCount >= maxUsers) {
				return next(new Error('[[error:cant-add-more-users-to-chat-room]]'));
			}
			next();
		},
		(next) => {
			user.getUidByUsername(data.username, next);
		},
		(_uid, next) => {
			uid = _uid;
			if (!uid) {
				return next(new Error('[[error:no-user]]'));
			}
			if (socket.uid === parseInt(uid, 10)) {
				return next(new Error('[[error:cant-add-self-to-chat-room]]'));
			}
			async.parallel({
				settings: async.apply(user.getSettings, uid),
				isAdminOrGlobalMod: async.apply(user.isAdminOrGlobalMod, socket.uid),
				isFollowing: async.apply(user.isFollowing, uid, socket.uid),
			}, next);
		},
		(results, next) => {
			if (results.settings.restrictChat && !results.isAdminOrGlobalMod && !results.isFollowing) {
				return next(new Error('[[error:chat-restricted]]'));
			}

			Messaging.addUsersToRoom(socket.uid, [uid], data.roomId, next);
		},
	], callback);
};

SocketModules.chats.removeUserFromRoom = (socket, data, callback) => {
	if (!data || !data.roomId) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	async.waterfall([
		(next) => {
			user.getUidByUsername(data.username, next);
		},
		(uid, next) => {
			if (!uid) {
				return next(new Error('[[error:no-user]]'));
			}

			Messaging.removeUsersFromRoom(socket.uid, [uid], data.roomId, next);
		},
	], callback);
};

SocketModules.chats.leave = (socket, roomid, callback) => {
	if (!socket.uid || !roomid) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	Messaging.leaveRoom([socket.uid], roomid, callback);
};


SocketModules.chats.edit = (socket, data, callback) => {
	if (!data || !data.roomId || !data.message) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	async.waterfall([
		(next) => {
			Messaging.canEdit(data.mid, socket.uid, next);
		},
		(next) => {
			Messaging.editMessage(socket.uid, data.mid, data.roomId, data.message, next);
		},
	], callback);
};

SocketModules.chats.delete = (socket, data, callback) => {
	if (!data || !data.roomId || !data.messageId) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	async.waterfall([
		(next) => {
			Messaging.canDelete(data.messageId, socket.uid, next);
		},
		(next) => {
			Messaging.deleteMessage(data.messageId, data.roomId, next);
		},
	], callback);
};

SocketModules.chats.canMessage = (socket, roomId, callback) => {
	Messaging.canMessageRoom(socket.uid, roomId, callback);
};

SocketModules.chats.markRead = (socket, roomId, callback) => {
	if (!socket.uid || !roomId) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	async.waterfall([
		(next) => {
			async.parallel({
				uidsInRoom: async.apply(Messaging.getUidsInRoom, roomId, 0, -1),
				markRead: async.apply(Messaging.markRead, socket.uid, roomId),
			}, next);
		},
		(results, next) => {
			Messaging.pushUnreadCount(socket.uid);
			server.in('uid_' + socket.uid).emit('event:chats.markedAsRead', { roomId: roomId });

			if (results.uidsInRoom.indexOf(socket.uid.toString()) === -1) {
				return callback();
			}

			// Mark notification read
			var nids = results.uidsInRoom.filter(uid => parseInt(uid, 10) !== socket.uid).map(uid => 'chat_' + uid + '_' + roomId);

			notifications.markReadMultiple(nids, socket.uid, () => {
				user.notifications.pushCount(socket.uid);
			});

			next();
		},
	], callback);
};

SocketModules.chats.markAllRead = (socket, data, callback) => {
	async.waterfall([
		(next) => {
			Messaging.markAllRead(socket.uid, next);
		},
		(next) => {
			Messaging.pushUnreadCount(socket.uid);
			next();
		},
	], callback);
};

SocketModules.chats.renameRoom = (socket, data, callback) => {
	if (!data || !data.roomId || !data.newName) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	async.waterfall([
		(next) => {
			Messaging.renameRoom(socket.uid, data.roomId, data.newName, next);
		},
		(next) => {
			Messaging.getUidsInRoom(data.roomId, 0, -1, next);
		},
		(uids, next) => {
			var eventData = { roomId: data.roomId, newName: validator.escape(String(data.newName)) };
			uids.forEach((uid) => {
				server.in('uid_' + uid).emit('event:chats.roomRename', eventData);
			});
			next();
		},
	], callback);
};

SocketModules.chats.getRecentChats = (socket, data, callback) => {
	if (!data || !utils.isNumber(data.after) || !utils.isNumber(data.uid)) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	var start = parseInt(data.after, 10);
	var stop = start + 9;
	Messaging.getRecentChats(socket.uid, data.uid, start, stop, callback);
};

SocketModules.chats.hasPrivateChat = (socket, uid, callback) => {
	if (!socket.uid || !uid) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	Messaging.hasPrivateChat(socket.uid, uid, callback);
};

SocketModules.chats.getMessages = (socket, data, callback) => {
	if (!socket.uid || !data || !data.uid || !data.roomId) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	var params = {
		callerUid: socket.uid,
		uid: data.uid,
		roomId: data.roomId,
		start: parseInt(data.start, 10) || 0,
		count: 50,
	};

	Messaging.getMessages(params, callback);
};

/* Sounds */
SocketModules.sounds.getUserSoundMap = function getUserSoundMap(socket, data, callback) {
	meta.sounds.getUserSoundMap(socket.uid, callback);
};
