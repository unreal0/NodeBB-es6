var async = require('async');
var validator = require('validator');

var db = require('../../database');
var groups = require('../../groups');
var user = require('../../user');
var events = require('../../events');
var meta = require('../../meta');
var plugins = require('../../plugins');

var User = module.exports;

User.makeAdmins = (socket, uids, callback) => {
	if (!Array.isArray(uids)) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	async.waterfall([
		(next) => {
			user.getUsersFields(uids, ['banned'], next);
		},
		(userData, next) => {
			for (var i = 0; i < userData.length; i += 1) {
				if (userData[i] && parseInt(userData[i].banned, 10) === 1) {
					return callback(new Error('[[error:cant-make-banned-users-admin]]'));
				}
			}

			async.each(uids, (uid, next) => {
				groups.join('administrators', uid, next);
			}, next);
		},
	], callback);
};

User.removeAdmins = (socket, uids, callback) => {
	if (!Array.isArray(uids)) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	async.eachSeries(uids, (uid, next) => {
		async.waterfall([
			(next) => {
				groups.getMemberCount('administrators', next);
			},
			(count, next) => {
				if (count === 1) {
					return next(new Error('[[error:cant-remove-last-admin]]'));
				}

				groups.leave('administrators', uid, next);
			},
		], next);
	}, callback);
};

User.createUser = (socket, userData, callback) => {
	if (!userData) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	user.create(userData, callback);
};

User.resetLockouts = (socket, uids, callback) => {
	if (!Array.isArray(uids)) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	async.each(uids, user.auth.resetLockout, callback);
};

User.validateEmail = (socket, uids, callback) => {
	if (!Array.isArray(uids)) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	uids = uids.filter(uid => parseInt(uid, 10));

	async.waterfall([
		(next) => {
			async.each(uids, (uid, next) => {
				user.setUserField(uid, 'email:confirmed', 1, next);
			}, next);
		},
		(next) => {
			db.sortedSetRemove('users:notvalidated', uids, next);
		},
	], callback);
};

User.sendValidationEmail = (socket, uids, callback) => {
	if (!Array.isArray(uids)) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	if (parseInt(meta.config.requireEmailConfirmation, 10) !== 1) {
		return callback(new Error('[[error:email-confirmations-are-disabled]]'));
	}

	async.eachLimit(uids, 50, (uid, next) => {
		user.email.sendValidationEmail(uid, next);
	}, callback);
};

User.sendPasswordResetEmail = (socket, uids, callback) => {
	if (!Array.isArray(uids)) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	uids = uids.filter(uid => parseInt(uid, 10));

	async.each(uids, (uid, next) => {
		async.waterfall([
			(next) => {
				user.getUserFields(uid, ['email', 'username'], next);
			},
			(userData, next) => {
				if (!userData.email) {
					return next(new Error('[[error:user-doesnt-have-email, ' + userData.username + ']]'));
				}
				user.reset.send(userData.email, next);
			},
		], next);
	}, callback);
};

User.deleteUsers = (socket, uids, callback) => {
	deleteUsers(socket, uids, (uid, next) => {
		user.deleteAccount(uid, next);
	}, callback);
};

User.deleteUsersAndContent = (socket, uids, callback) => {
	deleteUsers(socket, uids, (uid, next) => {
		user.delete(socket.uid, uid, next);
	}, callback);
};

function deleteUsers(socket, uids, method, callback) {
	if (!Array.isArray(uids)) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	async.each(uids, (uid, next) => {
		async.waterfall([
			(next) => {
				user.isAdministrator(uid, next);
			},
			(isAdmin, next) => {
				if (isAdmin) {
					return next(new Error('[[error:cant-delete-other-admins]]'));
				}

				method(uid, next);
			},
			(next) => {
				events.log({
					type: 'user-delete',
					uid: socket.uid,
					targetUid: uid,
					ip: socket.ip,
				}, next);
			},
			(next) => {
				plugins.fireHook('action:user.delete', {
					callerUid: socket.uid,
					uid: uid,
					ip: socket.ip,
				});
				next();
			},
		], next);
	}, callback);
}

User.search = (socket, data, callback) => {
	var searchData;
	async.waterfall([
		(next) => {
			user.search({
				query: data.query,
				searchBy: data.searchBy,
				uid: socket.uid,
			}, next);
		},
		(_searchData, next) => {
			searchData = _searchData;
			if (!searchData.users.length) {
				return callback(null, searchData);
			}

			var uids = searchData.users.map(user => user && user.uid);

			user.getUsersFields(uids, ['email', 'flags', 'lastonline', 'joindate'], next);
		},
		(userInfo, next) => {
			searchData.users.forEach((user, index) => {
				if (user && userInfo[index]) {
					user.email = validator.escape(String(userInfo[index].email || ''));
					user.flags = userInfo[index].flags || 0;
					user.lastonlineISO = userInfo[index].lastonlineISO;
					user.joindateISO = userInfo[index].joindateISO;
				}
			});
			next(null, searchData);
		},
	], callback);
};

User.deleteInvitation = (socket, data, callback) => {
	user.deleteInvitation(data.invitedBy, data.email, callback);
};

User.acceptRegistration = (socket, data, callback) => {
	async.waterfall([
		(next) => {
			user.acceptRegistration(data.username, next);
		},
		(uid, next) => {
			events.log({
				type: 'registration-approved',
				uid: socket.uid,
				ip: socket.ip,
				targetUid: uid,
			});
			next(null, uid);
		},
	], callback);
};

User.rejectRegistration = (socket, data, callback) => {
	async.waterfall([
		(next) => {
			user.rejectRegistration(data.username, next);
		},
		(next) => {
			events.log({
				type: 'registration-rejected',
				uid: socket.uid,
				ip: socket.ip,
				username: data.username,
			});
			next();
		},
	], callback);
};

User.restartJobs = (socket, data, callback) => {
	user.startJobs(callback);
};
