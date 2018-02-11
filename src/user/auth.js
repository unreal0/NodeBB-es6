var async = require('async');
var winston = require('winston');
var validator = require('validator');
var db = require('../database');
var meta = require('../meta');
var events = require('../events');
var batch = require('../batch');
var utils = require('../utils');

module.exports = (User) => {
	User.auth = {};

	User.auth.logAttempt = (uid, ip, callback) => {
		if (!parseInt(uid, 10)) {
			return setImmediate(callback);
		}
		async.waterfall([
			(next) => {
				db.exists('lockout:' + uid, next);
			},
			(exists, next) => {
				if (exists) {
					return callback(new Error('[[error:account-locked]]'));
				}
				db.increment('loginAttempts:' + uid, next);
			},
			(attemps, next) => {
				var loginAttempts = parseInt(meta.config.loginAttempts, 10) || 5;
				if (attemps <= loginAttempts) {
					return db.pexpire('loginAttempts:' + uid, 1000 * 60 * 60, callback);
				}
				// Lock out the account
				db.set('lockout:' + uid, '', next);
			},
			(next) => {
				var duration = 1000 * 60 * (meta.config.lockoutDuration || 60);

				db.delete('loginAttempts:' + uid);
				db.pexpire('lockout:' + uid, duration);
				events.log({
					type: 'account-locked',
					uid: uid,
					ip: ip,
				});
				next(new Error('[[error:account-locked]]'));
			},
		], callback);
	};

	User.auth.getFeedToken = (uid, callback) => {
		if (!uid) {
			return callback();
		}
		var token;
		async.waterfall([
			(next) => {
				db.getObjectField('user:' + uid, 'rss_token', next);
			},
			(_token, next) => {
				token = _token || utils.generateUUID();
				if (!_token) {
					User.setUserField(uid, 'rss_token', token, next);
				} else {
					next();
				}
			},
			(next) => {
				next(null, token);
			},
		], callback);
	};

	User.auth.clearLoginAttempts = (uid) => {
		db.delete('loginAttempts:' + uid);
	};

	User.auth.resetLockout = (uid, callback) => {
		async.parallel([
			async.apply(db.delete, 'loginAttempts:' + uid),
			async.apply(db.delete, 'lockout:' + uid),
		], callback);
	};

	User.auth.getSessions = (uid, curSessionId, callback) => {
		var _sids;

		// curSessionId is optional
		if (arguments.length === 2 && typeof curSessionId === 'function') {
			callback = curSessionId;
			curSessionId = undefined;
		}

		async.waterfall([
			async.apply(db.getSortedSetRevRange, 'uid:' + uid + ':sessions', 0, 19),
			(sids, next) => {
				_sids = sids;
				async.map(sids, db.sessionStore.get.bind(db.sessionStore), next);
			},
			(sessions, next) => {
				sessions.forEach((sessionObj, idx) => {
					if (sessionObj && sessionObj.meta) {
						sessionObj.meta.current = curSessionId === _sids[idx];
					}
				});

				// Revoke any sessions that have expired, return filtered list
				var expiredSids = [];
				var expired;

				sessions = sessions.filter((sessionObj, idx) => {
					expired = !sessionObj || !sessionObj.hasOwnProperty('passport') ||
						!sessionObj.passport.hasOwnProperty('user')	||
						parseInt(sessionObj.passport.user, 10) !== parseInt(uid, 10);

					if (expired) {
						expiredSids.push(_sids[idx]);
					}

					return !expired;
				});

				async.each(expiredSids, (sid, next) => {
					User.auth.revokeSession(sid, uid, next);
				}, (err) => {
					next(err, sessions);
				});
			},
			(sessions, next) => {
				sessions = sessions.map((sessObj) => {
					if (sessObj.meta) {
						sessObj.meta.datetimeISO = new Date(sessObj.meta.datetime).toISOString();
						sessObj.meta.ip = validator.escape(String(sessObj.meta.ip));
					}
					return sessObj.meta;
				}).filter(Boolean);
				next(null, sessions);
			},
		], callback);
	};

	User.auth.addSession = (uid, sessionId, callback) => {
		callback = callback || function () {};
		db.sortedSetAdd('uid:' + uid + ':sessions', Date.now(), sessionId, callback);
	};

	User.auth.revokeSession = (sessionId, uid, callback) => {
		winston.verbose('[user.auth] Revoking session ' + sessionId + ' for user ' + uid);

		async.waterfall([
			(next) => {
				db.sessionStore.get(sessionId, (err, sessionObj) => {
					next(err, sessionObj || null);
				});
			},
			(sessionObj, next) => {
				async.parallel([
					(next) => {
						if (sessionObj && sessionObj.meta && sessionObj.meta.uuid) {
							db.deleteObjectField('uid:' + uid + ':sessionUUID:sessionId', sessionObj.meta.uuid, next);
						} else {
							next();
						}
					},
					async.apply(db.sortedSetRemove, 'uid:' + uid + ':sessions', sessionId),
					async.apply(db.sessionStore.destroy.bind(db.sessionStore), sessionId),
				], (err) => {
					next(err);
				});
			},
		], callback);
	};

	User.auth.revokeAllSessions = (uid, callback) => {
		async.waterfall([
			async.apply(db.getSortedSetRange, 'uid:' + uid + ':sessions', 0, -1),
			(sids, next) => {
				async.each(sids, (sid, next) => {
					User.auth.revokeSession(sid, uid, next);
				}, next);
			},
		], callback);
	};

	User.auth.deleteAllSessions = (callback) => {
		var _ = require('lodash');
		batch.processSortedSet('users:joindate', (uids, next) => {
			var sessionKeys = uids.map(uid => 'uid:' + uid + ':sessions');

			var sessionUUIDKeys = uids.map(uid => 'uid:' + uid + ':sessionUUID:sessionId');

			async.waterfall([
				(next) => {
					db.getSortedSetRange(sessionKeys, 0, -1, next);
				},
				(sids, next) => {
					sids = _.flatten(sids);
					async.parallel([
						async.apply(db.deleteAll, sessionUUIDKeys),
						async.apply(db.deleteAll, sessionKeys),
						(next) => {
							async.each(sids, (sid, next) => {
								db.sessionStore.destroy(sid, next);
							}, next);
						},
					], next);
				},
			], next);
		}, { batch: 1000 }, callback);
	};
};
