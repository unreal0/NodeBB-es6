var async = require('async');

var utils = require('../utils');
var meta = require('../meta');
var db = require('../database');
var groups = require('../groups');
var plugins = require('../plugins');

module.exports = (User) => {
	User.updateProfile = (uid, data, callback) => {
		var fields = ['username', 'email', 'fullname', 'website', 'location',
			'groupTitle', 'birthday', 'signature', 'aboutme'];

		var updateUid = data.uid;
		var oldData;

		async.waterfall([
			(next) => {
				plugins.fireHook('filter:user.updateProfile', { uid: uid, data: data, fields: fields }, next);
			},
			(data, next) => {
				fields = data.fields;
				data = data.data;

				validateData(uid, data, next);
			},
			(next) => {
				User.getUserFields(updateUid, fields, next);
			},
			(_oldData, next) => {
				oldData = _oldData;
				async.each(fields, (field, next) => {
					if (!(data[field] !== undefined && typeof data[field] === 'string')) {
						return next();
					}

					data[field] = data[field].trim();

					if (field === 'email') {
						return updateEmail(updateUid, data.email, next);
					} else if (field === 'username') {
						return updateUsername(updateUid, data.username, next);
					} else if (field === 'fullname') {
						return updateFullname(updateUid, data.fullname, next);
					} else if (field === 'signature') {
						data[field] = utils.stripHTMLTags(data[field]);
					}

					User.setUserField(updateUid, field, data[field], next);
				}, next);
			},
			(next) => {
				plugins.fireHook('action:user.updateProfile', { uid: uid, data: data, fields: fields, oldData: oldData });
				User.getUserFields(updateUid, ['email', 'username', 'userslug', 'picture', 'icon:text', 'icon:bgColor'], next);
			},
		], callback);
	};

	function validateData(callerUid, data, callback) {
		async.series([
			async.apply(isEmailAvailable, data, data.uid),
			async.apply(isUsernameAvailable, data, data.uid),
			async.apply(isGroupTitleValid, data),
			async.apply(isWebsiteValid, callerUid, data),
			async.apply(isAboutMeValid, callerUid, data),
			async.apply(isSignatureValid, callerUid, data),
		], (err) => {
			callback(err);
		});
	}

	function isEmailAvailable(data, uid, callback) {
		if (!data.email) {
			return callback();
		}

		if (!utils.isEmailValid(data.email)) {
			return callback(new Error('[[error:invalid-email]]'));
		}

		async.waterfall([
			(next) => {
				User.getUserField(uid, 'email', next);
			},
			(email, next) => {
				if (email === data.email) {
					return callback();
				}
				User.email.available(data.email, next);
			},
			(available, next) => {
				next(!available ? new Error('[[error:email-taken]]') : null);
			},
		], callback);
	}

	function isUsernameAvailable(data, uid, callback) {
		if (!data.username) {
			return callback();
		}
		data.username = data.username.trim();
		async.waterfall([
			(next) => {
				User.getUserFields(uid, ['username', 'userslug'], next);
			},
			(userData, next) => {
				var userslug = utils.slugify(data.username);

				if (data.username.length < meta.config.minimumUsernameLength) {
					return next(new Error('[[error:username-too-short]]'));
				}

				if (data.username.length > meta.config.maximumUsernameLength) {
					return next(new Error('[[error:username-too-long]]'));
				}

				if (!utils.isUserNameValid(data.username) || !userslug) {
					return next(new Error('[[error:invalid-username]]'));
				}

				if (userslug === userData.userslug) {
					return callback();
				}
				User.existsBySlug(userslug, next);
			},
			(exists, next) => {
				next(exists ? new Error('[[error:username-taken]]') : null);
			},
		], callback);
	}

	function isGroupTitleValid(data, callback) {
		if (data.groupTitle === 'registered-users' || groups.isPrivilegeGroup(data.groupTitle)) {
			callback(new Error('[[error:invalid-group-title]]'));
		} else {
			callback();
		}
	}

	function isWebsiteValid(callerUid, data, callback) {
		if (!data.website) {
			return setImmediate(callback);
		}
		checkMinReputation(callerUid, data.uid, 'min:rep:website', callback);
	}

	function isAboutMeValid(callerUid, data, callback) {
		if (!data.aboutme) {
			return setImmediate(callback);
		}
		if (data.aboutme !== undefined && data.aboutme.length > meta.config.maximumAboutMeLength) {
			return callback(new Error('[[error:about-me-too-long, ' + meta.config.maximumAboutMeLength + ']]'));
		}

		checkMinReputation(callerUid, data.uid, 'min:rep:aboutme', callback);
	}

	function isSignatureValid(callerUid, data, callback) {
		if (!data.signature) {
			return setImmediate(callback);
		}
		if (data.signature !== undefined && data.signature.length > meta.config.maximumSignatureLength) {
			return callback(new Error('[[error:signature-too-long, ' + meta.config.maximumSignatureLength + ']]'));
		}
		checkMinReputation(callerUid, data.uid, 'min:rep:signature', callback);
	}

	function checkMinReputation(callerUid, uid, setting, callback) {
		var isSelf = parseInt(callerUid, 10) === parseInt(uid, 10);
		if (!isSelf) {
			return setImmediate(callback);
		}
		async.waterfall([
			(next) => {
				User.getUserField(uid, 'reputation', next);
			},
			(reputation, next) => {
				if (parseInt(reputation, 10) < (parseInt(meta.config[setting], 10) || 0)) {
					return next(new Error('[[error:not-enough-reputation-' + setting.replace(/:/g, '-') + ']]'));
				}
				next();
			},
		], callback);
	}

	function updateEmail(uid, newEmail, callback) {
		async.waterfall([
			(next) => {
				User.getUserField(uid, 'email', next);
			},
			(oldEmail, next) => {
				oldEmail = oldEmail || '';

				if (oldEmail === newEmail) {
					return callback();
				}
				async.series([
					async.apply(db.sortedSetRemove, 'email:uid', oldEmail.toLowerCase()),
					async.apply(db.sortedSetRemove, 'email:sorted', oldEmail.toLowerCase() + ':' + uid),
				], (err) => {
					next(err);
				});
			},
			(next) => {
				async.parallel([
					(next) => {
						db.sortedSetAdd('email:uid', uid, newEmail.toLowerCase(), next);
					},
					(next) => {
						db.sortedSetAdd('email:sorted', 0, newEmail.toLowerCase() + ':' + uid, next);
					},
					(next) => {
						db.sortedSetAdd('user:' + uid + ':emails', Date.now(), newEmail + ':' + Date.now(), next);
					},
					(next) => {
						User.setUserField(uid, 'email', newEmail, next);
					},
					(next) => {
						if (parseInt(meta.config.requireEmailConfirmation, 10) === 1 && newEmail) {
							User.email.sendValidationEmail(uid, {
								email: newEmail,
							});
						}
						User.setUserField(uid, 'email:confirmed', 0, next);
					},
					(next) => {
						db.sortedSetAdd('users:notvalidated', Date.now(), uid, next);
					},
					(next) => {
						User.reset.cleanByUid(uid, next);
					},
				], (err) => {
					next(err);
				});
			},
		], callback);
	}

	function updateUsername(uid, newUsername, callback) {
		if (!newUsername) {
			return setImmediate(callback);
		}

		async.waterfall([
			(next) => {
				User.getUserFields(uid, ['username', 'userslug'], next);
			},
			(userData, next) => {
				if (userData.username === newUsername) {
					return callback();
				}
				async.parallel([
					(next) => {
						updateUidMapping('username', uid, newUsername, userData.username, next);
					},
					(next) => {
						var newUserslug = utils.slugify(newUsername);
						updateUidMapping('userslug', uid, newUserslug, userData.userslug, next);
					},
					(next) => {
						var now = Date.now();
						async.series([
							async.apply(db.sortedSetRemove, 'username:sorted', userData.username.toLowerCase() + ':' + uid),
							async.apply(db.sortedSetAdd, 'username:sorted', 0, newUsername.toLowerCase() + ':' + uid),
							async.apply(db.sortedSetAdd, 'user:' + uid + ':usernames', now, newUsername + ':' + now),
						], next);
					},
				], next);
			},
		], (err) => {
			callback(err);
		});
	}

	function updateUidMapping(field, uid, value, oldValue, callback) {
		if (value === oldValue) {
			return callback();
		}

		async.series([
			(next) => {
				db.sortedSetRemove(field + ':uid', oldValue, next);
			},
			(next) => {
				User.setUserField(uid, field, value, next);
			},
			(next) => {
				if (value) {
					db.sortedSetAdd(field + ':uid', uid, value, next);
				} else {
					next();
				}
			},
		], callback);
	}

	function updateFullname(uid, newFullname, callback) {
		async.waterfall([
			(next) => {
				User.getUserField(uid, 'fullname', next);
			},
			(fullname, next) => {
				updateUidMapping('fullname', uid, newFullname, fullname, next);
			},
		], callback);
	}

	User.changePassword = (uid, data, callback) => {
		if (!uid || !data || !data.uid) {
			return callback(new Error('[[error:invalid-uid]]'));
		}

		async.waterfall([
			(next) => {
				User.isPasswordValid(data.newPassword, next);
			},
			(next) => {
				if (parseInt(uid, 10) !== parseInt(data.uid, 10)) {
					User.isAdministrator(uid, next);
				} else {
					User.isPasswordCorrect(uid, data.currentPassword, next);
				}
			},
			(isAdminOrPasswordMatch, next) => {
				if (!isAdminOrPasswordMatch) {
					return next(new Error('[[error:change_password_error_wrong_current]]'));
				}

				User.hashPassword(data.newPassword, next);
			},
			(hashedPassword, next) => {
				async.parallel([
					async.apply(User.setUserFields, data.uid, {
						password: hashedPassword,
						rss_token: utils.generateUUID(),
					}),
					async.apply(User.reset.updateExpiry, data.uid),
					async.apply(User.auth.revokeAllSessions, data.uid),
				], (err) => {
					next(err);
				});
			},
		], callback);
	};
};
