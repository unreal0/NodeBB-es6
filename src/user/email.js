var async = require('async');
var nconf = require('nconf');

var user = require('../user');
var utils = require('../utils');
var translator = require('../translator');
var plugins = require('../plugins');
var db = require('../database');
var meta = require('../meta');
var emailer = require('../emailer');

var UserEmail = module.exports;

UserEmail.exists = (email, callback) => {
	user.getUidByEmail(email.toLowerCase(), (err, exists) => {
		callback(err, !!exists);
	});
};

UserEmail.available = (email, callback) => {
	db.isSortedSetMember('email:uid', email.toLowerCase(), (err, exists) => {
		callback(err, !exists);
	});
};

UserEmail.sendValidationEmail = (uid, options, callback) => {
	/*
	 * 	Options:
	 * 		- email, overrides email retrieval
	 * 		- force, sends email even if it is too soon to send another
	 */

	// Handling for 2 arguments
	if (arguments.length === 2 && typeof options === 'function') {
		callback = options;
		options = {};
	}

	// Fallback behaviour (email passed in as second argument)
	if (typeof options === 'string') {
		options = {
			email: options,
		};
	}

	callback = callback || function () {};
	var confirm_code = utils.generateUUID();
	var confirm_link = nconf.get('url') + '/confirm/' + confirm_code;

	var emailInterval = meta.config.hasOwnProperty('emailConfirmInterval') ? parseInt(meta.config.emailConfirmInterval, 10) : 10;

	async.waterfall([
		(next) => {
			// If no email passed in (default), retrieve email from uid
			if (options.email && options.email.length) {
				return setImmediate(next, null, options.email);
			}

			user.getUserField(uid, 'email', next);
		},
		(email, next) => {
			options.email = email;
			if (!options.email) {
				return callback();
			}

			if (options.force) {
				return setImmediate(next, null, false);
			}

			db.get('uid:' + uid + ':confirm:email:sent', next);
		},
		(sent, next) => {
			if (sent) {
				return next(new Error('[[error:confirm-email-already-sent, ' + emailInterval + ']]'));
			}
			db.set('uid:' + uid + ':confirm:email:sent', 1, next);
		},
		(next) => {
			db.pexpireAt('uid:' + uid + ':confirm:email:sent', Date.now() + (emailInterval * 60 * 1000), next);
		},
		(next) => {
			plugins.fireHook('filter:user.verify.code', confirm_code, next);
		},
		(_confirm_code, next) => {
			confirm_code = _confirm_code;
			db.setObject('confirm:' + confirm_code, {
				email: options.email.toLowerCase(),
				uid: uid,
			}, next);
		},
		(next) => {
			db.expireAt('confirm:' + confirm_code, Math.floor((Date.now() / 1000) + (60 * 60 * 24)), next);
		},
		(next) => {
			user.getUserField(uid, 'username', next);
		},
		(username, next) => {
			var title = meta.config.title || meta.config.browserTitle || 'NodeBB';
			translator.translate('[[email:welcome-to, ' + title + ']]', meta.config.defaultLang, (subject) => {
				var data = {
					username: username,
					confirm_link: confirm_link,
					confirm_code: confirm_code,

					subject: subject,
					template: 'welcome',
					uid: uid,
				};

				if (plugins.hasListeners('action:user.verify')) {
					plugins.fireHook('action:user.verify', { uid: uid, data: data });
					next();
				} else {
					emailer.send('welcome', uid, data, next);
				}
			});
		},
		(next) => {
			next(null, confirm_code);
		},
	], callback);
};

UserEmail.confirm = (code, callback) => {
	async.waterfall([
		(next) => {
			db.getObject('confirm:' + code, next);
		},
		(confirmObj, next) => {
			if (!confirmObj || !confirmObj.uid || !confirmObj.email) {
				return next(new Error('[[error:invalid-data]]'));
			}
			async.series([
				async.apply(user.setUserField, confirmObj.uid, 'email:confirmed', 1),
				async.apply(db.delete, 'confirm:' + code),
				async.apply(db.delete, 'uid:' + confirmObj.uid + ':confirm:email:sent'),
				(next) => {
					db.sortedSetRemove('users:notvalidated', confirmObj.uid, next);
				},
				(next) => {
					plugins.fireHook('action:user.email.confirmed', { uid: confirmObj.uid, email: confirmObj.email }, next);
				},
			], next);
		},
	], (err) => {
		callback(err);
	});
};
