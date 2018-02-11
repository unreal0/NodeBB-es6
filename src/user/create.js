var async = require('async');
var db = require('../database');
var utils = require('../utils');
var validator = require('validator');
var plugins = require('../plugins');
var groups = require('../groups');
var meta = require('../meta');

module.exports = (User) => {
	User.create = (data, callback) => {
		data.username = data.username.trim();
		data.userslug = utils.slugify(data.username);
		if (data.email !== undefined) {
			data.email = validator.escape(String(data.email).trim());
		}
		var timestamp = data.timestamp || Date.now();
		var userData;
		var userNameChanged = false;

		async.waterfall([
			(next) => {
				User.isDataValid(data, next);
			},
			(next) => {
				userData = {
					username: data.username,
					userslug: data.userslug,
					email: data.email || '',
					joindate: timestamp,
					lastonline: timestamp,
					picture: data.picture || '',
					fullname: data.fullname || '',
					location: data.location || '',
					birthday: data.birthday || '',
					website: '',
					signature: '',
					uploadedpicture: '',
					profileviews: 0,
					reputation: 0,
					postcount: 0,
					topiccount: 0,
					lastposttime: 0,
					banned: 0,
					status: 'online',
				};

				User.uniqueUsername(userData, next);
			},
			(renamedUsername, next) => {
				userNameChanged = !!renamedUsername;

				if (userNameChanged) {
					userData.username = renamedUsername;
					userData.userslug = utils.slugify(renamedUsername);
				}
				plugins.fireHook('filter:user.create', { user: userData, data: data }, next);
			},
			(results, next) => {
				userData = results.user;
				db.incrObjectField('global', 'nextUid', next);
			},
			(uid, next) => {
				userData.uid = uid;
				db.setObject('user:' + uid, userData, next);
			},
			(next) => {
				async.parallel([
					(next) => {
						db.incrObjectField('global', 'userCount', next);
					},
					(next) => {
						db.sortedSetAdd('username:uid', userData.uid, userData.username, next);
					},
					(next) => {
						db.sortedSetAdd('username:sorted', 0, userData.username.toLowerCase() + ':' + userData.uid, next);
					},
					(next) => {
						db.sortedSetAdd('userslug:uid', userData.uid, userData.userslug, next);
					},
					(next) => {
						var sets = ['users:joindate', 'users:online'];
						if (parseInt(userData.uid, 10) !== 1) {
							sets.push('users:notvalidated');
						}
						db.sortedSetsAdd(sets, timestamp, userData.uid, next);
					},
					(next) => {
						db.sortedSetsAdd(['users:postcount', 'users:reputation'], 0, userData.uid, next);
					},
					(next) => {
						groups.join('registered-users', userData.uid, next);
					},
					(next) => {
						User.notifications.sendWelcomeNotification(userData.uid, next);
					},
					(next) => {
						if (userData.email) {
							async.parallel([
								async.apply(db.sortedSetAdd, 'email:uid', userData.uid, userData.email.toLowerCase()),
								async.apply(db.sortedSetAdd, 'email:sorted', 0, userData.email.toLowerCase() + ':' + userData.uid),
							], next);

							if (parseInt(userData.uid, 10) !== 1 && parseInt(meta.config.requireEmailConfirmation, 10) === 1) {
								User.email.sendValidationEmail(userData.uid, {
									email: userData.email,
								});
							}
						} else {
							next();
						}
					},
					(next) => {
						if (!data.password) {
							return next();
						}

						User.hashPassword(data.password, (err, hash) => {
							if (err) {
								return next(err);
							}

							async.parallel([
								async.apply(User.setUserField, userData.uid, 'password', hash),
								async.apply(User.reset.updateExpiry, userData.uid),
							], next);
						});
					},
					(next) => {
						User.updateDigestSetting(userData.uid, meta.config.dailyDigestFreq, next);
					},
				], next);
			},
			(results, next) => {
				if (userNameChanged) {
					User.notifications.sendNameChangeNotification(userData.uid, userData.username);
				}
				plugins.fireHook('action:user.create', { user: userData });
				next(null, userData.uid);
			},
		], callback);
	};

	User.isDataValid = (userData, callback) => {
		async.parallel({
			emailValid: (next) => {
				if (userData.email) {
					next(!utils.isEmailValid(userData.email) ? new Error('[[error:invalid-email]]') : null);
				} else {
					next();
				}
			},
			userNameValid: (next) => {
				next((!utils.isUserNameValid(userData.username) || !userData.userslug) ? new Error('[[error:invalid-username, ' + userData.username + ']]') : null);
			},
			passwordValid: (next) => {
				if (userData.password) {
					User.isPasswordValid(userData.password, next);
				} else {
					next();
				}
			},
			emailAvailable: (next) => {
				if (userData.email) {
					User.email.available(userData.email, (err, available) => {
						if (err) {
							return next(err);
						}
						next(!available ? new Error('[[error:email-taken]]') : null);
					});
				} else {
					next();
				}
			},
		}, (err) => {
			callback(err);
		});
	};

	User.isPasswordValid = (password, callback) => {
		if (!password || !utils.isPasswordValid(password)) {
			return callback(new Error('[[error:invalid-password]]'));
		}

		if (password.length < meta.config.minimumPasswordLength) {
			return callback(new Error('[[user:change_password_error_length]]'));
		}

		if (password.length > 4096) {
			return callback(new Error('[[error:password-too-long]]'));
		}

		callback();
	};

	User.uniqueUsername = (userData, callback) => {
		var numTries = 0;
		function go(username) {
			async.waterfall([
				(next) => {
					meta.userOrGroupExists(username, next);
				},
				(exists) => {
					if (!exists) {
						return callback(null, numTries ? username : null);
					}
					username = userData.username + ' ' + numTries.toString(32);
					numTries += 1;
					go(username);
				},
			], callback);
		}

		go(userData.userslug);
	};
};
