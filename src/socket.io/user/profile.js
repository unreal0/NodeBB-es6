var async = require('async');

var user = require('../../user');
var meta = require('../../meta');
var events = require('../../events');
var privileges = require('../../privileges');

module.exports = (SocketUser) => {
	SocketUser.changeUsernameEmail = (socket, data, callback) => {
		if (!data || !data.uid || !socket.uid) {
			return callback(new Error('[[error:invalid-data]]'));
		}

		async.waterfall([
			(next) => {
				isPrivilegedOrSelfAndPasswordMatch(socket.uid, data, next);
			},
			(next) => {
				SocketUser.updateProfile(socket, data, next);
			},
		], callback);
	};

	SocketUser.updateCover = (socket, data, callback) => {
		if (!socket.uid) {
			return callback(new Error('[[error:no-privileges]]'));
		}
		async.waterfall([
			(next) => {
				user.isAdminOrGlobalModOrSelf(socket.uid, data.uid, next);
			},
			(next) => {
				user.updateCoverPicture(data, next);
			},
		], callback);
	};

	SocketUser.uploadCroppedPicture = (socket, data, callback) => {
		if (!socket.uid) {
			return callback(new Error('[[error:no-privileges]]'));
		}
		async.waterfall([
			(next) => {
				user.isAdminOrGlobalModOrSelf(socket.uid, data.uid, next);
			},
			(next) => {
				user.uploadCroppedPicture(data, next);
			},
		], callback);
	};

	SocketUser.removeCover = (socket, data, callback) => {
		if (!socket.uid) {
			return callback(new Error('[[error:no-privileges]]'));
		}

		async.waterfall([
			(next) => {
				user.isAdminOrGlobalModOrSelf(socket.uid, data.uid, next);
			},
			(next) => {
				user.removeCoverPicture(data, next);
			},
		], callback);
	};

	function isPrivilegedOrSelfAndPasswordMatch(uid, data, callback) {
		async.waterfall([
			(next) => {
				async.parallel({
					isAdmin: async.apply(user.isAdministrator, uid),
					isTargetAdmin: async.apply(user.isAdministrator, data.uid),
					isGlobalMod: async.apply(user.isGlobalModerator, uid),
					hasPassword: async.apply(user.hasPassword, data.uid),
					passwordMatch: (next) => {
						if (data.password) {
							user.isPasswordCorrect(data.uid, data.password, next);
						} else {
							next(null, false);
						}
					},
				}, next);
			},
			(results, next) => {
				var isSelf = parseInt(uid, 10) === parseInt(data.uid, 10);

				if (results.isTargetAdmin && !results.isAdmin) {
					return next(new Error('[[error:no-privileges]]'));
				}

				if ((!results.isAdmin || !results.isGlobalMod) && !isSelf) {
					return next(new Error('[[error:no-privileges]]'));
				}

				if (isSelf && results.hasPassword && !results.passwordMatch) {
					return next(new Error('[[error:invalid-password]]'));
				}

				next();
			},
		], callback);
	}

	SocketUser.changePassword = (socket, data, callback) => {
		if (!socket.uid) {
			return callback(new Error('[[error:invalid-uid]]'));
		}

		if (!data || !data.uid) {
			return callback(new Error('[[error:invalid-data]]'));
		}
		async.waterfall([
			(next) => {
				user.changePassword(socket.uid, data, next);
			},
			(next) => {
				events.log({
					type: 'password-change',
					uid: socket.uid,
					targetUid: data.uid,
					ip: socket.ip,
				});
				next();
			},
		], callback);
	};

	SocketUser.updateProfile = (socket, data, callback) => {
		if (!socket.uid) {
			return callback(new Error('[[error:invalid-uid]]'));
		}

		if (!data || !data.uid) {
			return callback(new Error('[[error:invalid-data]]'));
		}

		var oldUserData;
		async.waterfall([
			(next) => {
				user.getUserFields(data.uid, ['email', 'username'], next);
			},
			(_oldUserData, next) => {
				oldUserData = _oldUserData;
				if (!oldUserData || !oldUserData.username) {
					return next(new Error('[[error:invalid-data]]'));
				}

				async.parallel({
					isAdminOrGlobalMod: (next) => {
						user.isAdminOrGlobalMod(socket.uid, next);
					},
					canEdit: (next) => {
						privileges.users.canEdit(socket.uid, data.uid, next);
					},
				}, next);
			},
			(results, next) => {
				if (!results.canEdit) {
					return next(new Error('[[error:no-privileges]]'));
				}

				if (!results.isAdminOrGlobalMod && parseInt(meta.config['username:disableEdit'], 10) === 1) {
					data.username = oldUserData.username;
				}

				if (!results.isAdminOrGlobalMod && parseInt(meta.config['email:disableEdit'], 10) === 1) {
					data.email = oldUserData.email;
				}

				user.updateProfile(socket.uid, data, next);
			},
			(userData, next) => {
				function log(type, eventData) {
					eventData.type = type;
					eventData.uid = socket.uid;
					eventData.targetUid = data.uid;
					eventData.ip = socket.ip;

					events.log(eventData);
				}

				if (userData.email !== oldUserData.email) {
					log('email-change', { oldEmail: oldUserData.email, newEmail: userData.email });
				}

				if (userData.username !== oldUserData.username) {
					log('username-change', { oldUsername: oldUserData.username, newUsername: userData.username });
				}

				next(null, userData);
			},
		], callback);
	};
};
