var async = require('async');
var winston = require('winston');

var user = require('../../user');
var meta = require('../../meta');
var websockets = require('../index');
var events = require('../../events');
var privileges = require('../../privileges');
var plugins = require('../../plugins');
var emailer = require('../../emailer');
var translator = require('../../translator');
var utils = require('../../../public/src/utils');

module.exports = (SocketUser) => {
	SocketUser.banUsers = (socket, data, callback) => {
		if (!data || !Array.isArray(data.uids)) {
			return callback(new Error('[[error:invalid-data]]'));
		}

		toggleBan(socket.uid, data.uids, (uid, next) => {
			async.waterfall([
				(next) => {
					banUser(uid, data.until || 0, data.reason || '', next);
				},
				(next) => {
					events.log({
						type: 'user-ban',
						uid: socket.uid,
						targetUid: uid,
						ip: socket.ip,
					}, next);
				},
				(next) => {
					plugins.fireHook('action:user.banned', {
						callerUid: socket.uid,
						ip: socket.ip,
						uid: uid,
						until: data.until > 0 ? data.until : undefined,
					});
					next();
				},
				(next) => {
					user.auth.revokeAllSessions(uid, next);
				},
			], next);
		}, callback);
	};

	SocketUser.unbanUsers = (socket, uids, callback) => {
		toggleBan(socket.uid, uids, (uid, next) => {
			async.waterfall([
				(next) => {
					user.unban(uid, next);
				},
				(next) => {
					events.log({
						type: 'user-unban',
						uid: socket.uid,
						targetUid: uid,
						ip: socket.ip,
					}, next);
				},
				(next) => {
					plugins.fireHook('action:user.unbanned', {
						callerUid: socket.uid,
						ip: socket.ip,
						uid: uid,
					});
					next();
				},
			], next);
		}, callback);
	};

	function toggleBan(uid, uids, method, callback) {
		if (!Array.isArray(uids)) {
			return callback(new Error('[[error:invalid-data]]'));
		}

		async.waterfall([
			(next) => {
				privileges.users.hasBanPrivilege(uid, next);
			},
			(hasBanPrivilege, next) => {
				if (!hasBanPrivilege) {
					return next(new Error('[[error:no-privileges]]'));
				}
				async.each(uids, method, next);
			},
		], callback);
	}

	function banUser(uid, until, reason, callback) {
		async.waterfall([
			(next) => {
				user.isAdministrator(uid, next);
			},
			(isAdmin, next) => {
				if (isAdmin) {
					return next(new Error('[[error:cant-ban-other-admins]]'));
				}

				user.getUserField(uid, 'username', next);
			},
			(username, next) => {
				var siteTitle = meta.config.title || 'NodeBB';
				var data = {
					subject: '[[email:banned.subject, ' + siteTitle + ']]',
					username: username,
					until: until ? utils.toISOString(until) : false,
					reason: reason,
				};

				emailer.send('banned', uid, data, (err) => {
					if (err) {
						winston.error('[emailer.send] ' + err.message);
					}
					next();
				});
			},
			(next) => {
				user.ban(uid, until, reason, next);
			},
			(next) => {
				if (!reason) {
					return translator.translate('[[user:info.banned-no-reason]]', (translated) => {
						next(null, translated);
					});
				}

				next(null, reason);
			},
			(_reason, next) => {
				websockets.in('uid_' + uid).emit('event:banned', {
					until: until,
					reason: _reason,
				});
				next();
			},
		], callback);
	}
};

