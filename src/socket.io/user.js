var async = require('async');
var winston = require('winston');

var user = require('../user');
var topics = require('../topics');
var notifications = require('../notifications');
var messaging = require('../messaging');
var plugins = require('../plugins');
var meta = require('../meta');
var events = require('../events');
var emailer = require('../emailer');
var db = require('../database');
var userController = require('../controllers/user');
var privileges = require('../privileges');

var SocketUser = module.exports;

require('./user/profile')(SocketUser);
require('./user/search')(SocketUser);
require('./user/status')(SocketUser);
require('./user/picture')(SocketUser);
require('./user/ban')(SocketUser);

SocketUser.exists = (socket, data, callback) => {
	if (!data || !data.username) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	meta.userOrGroupExists(data.username, callback);
};

SocketUser.deleteAccount = (socket, data, callback) => {
	if (!socket.uid) {
		return callback(new Error('[[error:no-privileges]]'));
	}

	async.waterfall([
		(next) => {
			user.isAdministrator(socket.uid, next);
		},
		(isAdmin, next) => {
			if (isAdmin) {
				return next(new Error('[[error:cant-delete-admin]]'));
			}
			user.deleteAccount(socket.uid, next);
		},
		(next) => {
			require('./index').server.sockets.emit('event:user_status_change', { uid: socket.uid, status: 'offline' });

			events.log({
				type: 'user-delete',
				uid: socket.uid,
				targetUid: socket.uid,
				ip: socket.ip,
			});
			next();
		},
	], callback);
};

SocketUser.emailExists = (socket, data, callback) => {
	if (!data || !data.email) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	user.email.exists(data.email, callback);
};

SocketUser.emailConfirm = (socket, data, callback) => {
	if (!socket.uid) {
		return callback(new Error('[[error:no-privileges]]'));
	}

	if (parseInt(meta.config.requireEmailConfirmation, 10) !== 1) {
		return callback(new Error('[[error:email-confirmations-are-disabled]]'));
	}

	user.email.sendValidationEmail(socket.uid, callback);
};


// Password Reset
SocketUser.reset = {};

SocketUser.reset.send = (socket, email, callback) => {
	if (!email) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	user.reset.send(email, (err) => {
		if (err && err.message !== '[[error:invalid-email]]') {
			return callback(err);
		}
		if (err && err.message === '[[error:invalid-email]]') {
			winston.verbose('[user/reset] Invalid email attempt: ' + email);
			return setTimeout(callback, 2500);
		}

		callback();
	});
};

SocketUser.reset.commit = (socket, data, callback) => {
	if (!data || !data.code || !data.password) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	var uid;
	async.waterfall([
		(next) => {
			async.parallel({
				uid: async.apply(db.getObjectField, 'reset:uid', data.code),
				reset: async.apply(user.reset.commit, data.code, data.password),
			}, next);
		},
		(results, next) => {
			uid = results.uid;
			events.log({
				type: 'password-reset',
				uid: uid,
				ip: socket.ip,
			});

			user.getUserField(uid, 'username', next);
		},
		(username, next) => {
			var now = new Date();
			var parsedDate = now.getFullYear() + '/' + (now.getMonth() + 1) + '/' + now.getDate();
			emailer.send('reset_notify', uid, {
				username: username,
				date: parsedDate,
				subject: '[[email:reset.notify.subject]]',
			});

			next();
		},
	], callback);
};

SocketUser.isFollowing = (socket, data, callback) => {
	if (!socket.uid || !data.uid) {
		return callback(null, false);
	}

	user.isFollowing(socket.uid, data.uid, callback);
};

SocketUser.follow = (socket, data, callback) => {
	if (!socket.uid || !data) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	var userData;
	async.waterfall([
		(next) => {
			toggleFollow('follow', socket.uid, data.uid, next);
		},
		(next) => {
			user.getUserFields(socket.uid, ['username', 'userslug'], next);
		},
		(_userData, next) => {
			userData = _userData;
			notifications.create({
				type: 'follow',
				bodyShort: '[[notifications:user_started_following_you, ' + userData.username + ']]',
				nid: 'follow:' + data.uid + ':uid:' + socket.uid,
				from: socket.uid,
				path: '/uid/' + data.uid + '/followers',
				mergeId: 'notifications:user_started_following_you',
			}, next);
		},
		(notification, next) => {
			if (!notification) {
				return next();
			}
			notification.user = userData;
			notifications.push(notification, [data.uid], next);
		},
	], callback);
};

SocketUser.unfollow = (socket, data, callback) => {
	if (!socket.uid || !data) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	toggleFollow('unfollow', socket.uid, data.uid, callback);
};

function toggleFollow(method, uid, theiruid, callback) {
	async.waterfall([
		(next) => {
			user[method](uid, theiruid, next);
		},
		(next) => {
			plugins.fireHook('action:user.' + method, {
				fromUid: uid,
				toUid: theiruid,
			});
			next();
		},
	], callback);
}

SocketUser.saveSettings = (socket, data, callback) => {
	if (!socket.uid || !data) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	async.waterfall([
		(next) => {
			privileges.users.canEdit(socket.uid, data.uid, next);
		},
		(allowed, next) => {
			if (!allowed) {
				return next(new Error('[[error:no-privileges]]'));
			}
			user.saveSettings(data.uid, data.settings, next);
		},
	], callback);
};

SocketUser.setTopicSort = (socket, sort, callback) => {
	user.setSetting(socket.uid, 'topicPostSort', sort, callback);
};

SocketUser.setCategorySort = (socket, sort, callback) => {
	user.setSetting(socket.uid, 'categoryTopicSort', sort, callback);
};

SocketUser.getUnreadCount = (socket, data, callback) => {
	if (!socket.uid) {
		return callback(null, 0);
	}
	topics.getTotalUnread(socket.uid, callback);
};

SocketUser.getUnreadChatCount = (socket, data, callback) => {
	if (!socket.uid) {
		return callback(null, 0);
	}
	messaging.getUnreadCount(socket.uid, callback);
};

SocketUser.getUnreadCounts = (socket, data, callback) => {
	if (!socket.uid) {
		return callback(null, {});
	}
	async.parallel({
		unreadTopicCount: async.apply(topics.getTotalUnread, socket.uid),
		unreadNewTopicCount: async.apply(topics.getTotalUnread, socket.uid, 'new'),
		unreadWatchedTopicCount: async.apply(topics.getTotalUnread, socket.uid, 'watched'),
		unreadChatCount: async.apply(messaging.getUnreadCount, socket.uid),
		unreadNotificationCount: async.apply(user.notifications.getUnreadCount, socket.uid),
	}, callback);
};

SocketUser.invite = (socket, email, callback) => {
	if (!email || !socket.uid) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	var registrationType = meta.config.registrationType;

	if (registrationType !== 'invite-only' && registrationType !== 'admin-invite-only') {
		return callback(new Error('[[error:forum-not-invite-only]]'));
	}

	async.waterfall([
		(next) => {
			user.isAdministrator(socket.uid, next);
		},
		(isAdmin, next) => {
			if (registrationType === 'admin-invite-only' && !isAdmin) {
				return next(new Error('[[error:no-privileges]]'));
			}

			var max = parseInt(meta.config.maximumInvites, 10);
			if (!max) {
				return user.sendInvitationEmail(socket.uid, email, callback);
			}

			async.waterfall([
				(next) => {
					user.getInvitesNumber(socket.uid, next);
				},
				(invites, next) => {
					if (!isAdmin && invites >= max) {
						return next(new Error('[[error:invite-maximum-met, ' + invites + ', ' + max + ']]'));
					}

					user.sendInvitationEmail(socket.uid, email, next);
				},
			], next);
		},
	], callback);
};

SocketUser.getUserByUID = (socket, uid, callback) => {
	userController.getUserDataByField(socket.uid, 'uid', uid, callback);
};

SocketUser.getUserByUsername = (socket, username, callback) => {
	userController.getUserDataByField(socket.uid, 'username', username, callback);
};

SocketUser.getUserByEmail = (socket, email, callback) => {
	userController.getUserDataByField(socket.uid, 'email', email, callback);
};

SocketUser.setModerationNote = (socket, data, callback) => {
	if (!socket.uid || !data || !data.uid || !data.note) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	async.waterfall([
		(next) => {
			privileges.users.canEdit(socket.uid, data.uid, next);
		},
		(allowed, next) => {
			if (allowed) {
				return setImmediate(next, null, allowed);
			}

			user.isModeratorOfAnyCategory(socket.uid, next);
		},
		(allowed, next) => {
			if (!allowed) {
				return next(new Error('[[error:no-privileges]]'));
			}

			var note = {
				uid: socket.uid,
				note: data.note,
				timestamp: Date.now(),
			};
			db.sortedSetAdd('uid:' + data.uid + ':moderation:notes', note.timestamp, JSON.stringify(note), next);
		},
	], callback);
};
