var async = require('async');
var nconf = require('nconf');
var winston = require('winston');

var user = require('../user');
var utils = require('../utils');
var translator = require('../translator');
var batch = require('../batch');

var db = require('../database');
var meta = require('../meta');
var emailer = require('../emailer');

var UserReset = module.exports;

var twoHours = 7200000;

UserReset.validate = (code, callback) => {
	async.waterfall([
		(next) => {
			db.getObjectField('reset:uid', code, next);
		},
		(uid, next) => {
			if (!uid) {
				return callback(null, false);
			}
			db.sortedSetScore('reset:issueDate', code, next);
		},
		(issueDate, next) => {
			next(null, parseInt(issueDate, 10) > Date.now() - twoHours);
		},
	], callback);
};

UserReset.generate = (uid, callback) => {
	var code = utils.generateUUID();
	async.parallel([
		async.apply(db.setObjectField, 'reset:uid', code, uid),
		async.apply(db.sortedSetAdd, 'reset:issueDate', Date.now(), code),
	], (err) => {
		callback(err, code);
	});
};

function canGenerate(uid, callback) {
	async.waterfall([
		(next) => {
			db.sortedSetScore('reset:issueDate:uid', uid, next);
		},
		(score, next) => {
			if (score > Date.now() - (1000 * 60)) {
				return next(new Error('[[error:cant-reset-password-more-than-once-a-minute]]'));
			}
			next();
		},
	], callback);
}

UserReset.send = (email, callback) => {
	var uid;
	async.waterfall([
		(next) => {
			user.getUidByEmail(email, next);
		},
		(_uid, next) => {
			if (!_uid) {
				return next(new Error('[[error:invalid-email]]'));
			}

			uid = _uid;
			canGenerate(uid, next);
		},
		(next) => {
			db.sortedSetAdd('reset:issueDate:uid', Date.now(), uid, next);
		},
		(next) => {
			UserReset.generate(uid, next);
		},
		(code, next) => {
			translator.translate('[[email:password-reset-requested, ' + (meta.config.title || 'NodeBB') + ']]', meta.config.defaultLang, (subject) => {
				next(null, subject, code);
			});
		},
		(subject, code, next) => {
			var reset_link = nconf.get('url') + '/reset/' + code;
			emailer.send('reset', uid, {
				reset_link: reset_link,
				subject: subject,
				template: 'reset',
				uid: uid,
			}, next);
		},
	], callback);
};

UserReset.commit = (code, password, callback) => {
	var uid;
	async.waterfall([
		(next) => {
			user.isPasswordValid(password, next);
		},
		(next) => {
			UserReset.validate(code, next);
		},
		(validated, next) => {
			if (!validated) {
				return next(new Error('[[error:reset-code-not-valid]]'));
			}
			db.getObjectField('reset:uid', code, next);
		},
		(_uid, next) => {
			uid = _uid;
			if (!uid) {
				return next(new Error('[[error:reset-code-not-valid]]'));
			}

			user.hashPassword(password, next);
		},
		(hash, next) => {
			async.series([
				async.apply(user.setUserFields, uid, { password: hash, 'email:confirmed': 1 }),
				async.apply(db.deleteObjectField, 'reset:uid', code),
				async.apply(db.sortedSetRemove, 'reset:issueDate', code),
				async.apply(db.sortedSetRemove, 'reset:issueDate:uid', uid),
				async.apply(user.reset.updateExpiry, uid),
				async.apply(user.auth.resetLockout, uid),
				async.apply(db.delete, 'uid:' + uid + ':confirm:email:sent'),
				async.apply(db.sortedSetRemove, 'users:notvalidated', uid),
				async.apply(UserReset.cleanByUid, uid),
			], (err) => {
				next(err);
			});
		},
	], callback);
};

UserReset.updateExpiry = (uid, callback) => {
	var oneDay = 1000 * 60 * 60 * 24;
	var expireDays = parseInt(meta.config.passwordExpiryDays || 0, 10);
	var expiry = Date.now() + (oneDay * expireDays);

	callback = callback || function () {};
	user.setUserField(uid, 'passwordExpiry', expireDays > 0 ? expiry : 0, callback);
};

UserReset.clean = (callback) => {
	async.waterfall([
		(next) => {
			async.parallel({
				tokens: (next) => {
					db.getSortedSetRangeByScore('reset:issueDate', 0, -1, '-inf', Date.now() - twoHours, next);
				},
				uids: (next) => {
					db.getSortedSetRangeByScore('reset:issueDate:uid', 0, -1, '-inf', Date.now() - twoHours, next);
				},
			}, next);
		},
		(results, next) => {
			if (!results.tokens.length && !results.uids.length) {
				return next();
			}

			winston.verbose('[UserReset.clean] Removing ' + results.tokens.length + ' reset tokens from database');
			async.parallel([
				async.apply(db.deleteObjectFields, 'reset:uid', results.tokens),
				async.apply(db.sortedSetRemove, 'reset:issueDate', results.tokens),
				async.apply(db.sortedSetRemove, 'reset:issueDate:uid', results.uids),
			], next);
		},
	], callback);
};

UserReset.cleanByUid = (uid, callback) => {
	var toClean = [];
	uid = parseInt(uid, 10);

	async.waterfall([
		(next) => {
			batch.processSortedSet('reset:issueDate', (tokens, next) => {
				db.getObjectFields('reset:uid', tokens, (err, results) => {
					for (var code in results) {
						if (results.hasOwnProperty(code) && parseInt(results[code], 10) === uid) {
							toClean.push(code);
						}
					}

					next(err);
				});
			}, next);
		},
		(next) => {
			if (!toClean.length) {
				winston.verbose('[UserReset.cleanByUid] No tokens found for uid (' + uid + ').');
				return setImmediate(next);
			}

			winston.verbose('[UserReset.cleanByUid] Found ' + toClean.length + ' token(s), removing...');
			async.parallel([
				async.apply(db.deleteObjectFields, 'reset:uid', toClean),
				async.apply(db.sortedSetRemove, 'reset:issueDate', toClean),
				async.apply(db.sortedSetRemove, 'reset:issueDate:uid', uid),
			], next);
		},
	], callback);
};
