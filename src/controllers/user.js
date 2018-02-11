var async = require('async');

var user = require('../user');
var meta = require('../meta');
var accountHelpers = require('./accounts/helpers');

var userController = module.exports;

userController.getCurrentUser = (req, res, next) => {
	if (!req.uid) {
		return res.status(401).json('not-authorized');
	}
	async.waterfall([
		(next) => {
			user.getUserField(req.uid, 'userslug', next);
		},
		(userslug, next) => {
			accountHelpers.getUserDataByUserSlug(userslug, req.uid, next);
		},
		(userData) => {
			res.json(userData);
		},
	], next);
};


userController.getUserByUID = (req, res, next) => {
	byType('uid', req, res, next);
};

userController.getUserByUsername = (req, res, next) => {
	byType('username', req, res, next);
};

userController.getUserByEmail = (req, res, next) => {
	byType('email', req, res, next);
};

function byType(type, req, res, next) {
	async.waterfall([
		(next) => {
			userController.getUserDataByField(req.uid, type, req.params[type], next);
		},
		(data, next) => {
			if (!data) {
				return next();
			}
			res.json(data);
		},
	], next);
}

userController.getUserDataByField = (callerUid, field, fieldValue, callback) => {
	async.waterfall([
		(next) => {
			if (field === 'uid') {
				next(null, fieldValue);
			} else if (field === 'username') {
				user.getUidByUsername(fieldValue, next);
			} else if (field === 'email') {
				user.getUidByEmail(fieldValue, next);
			} else {
				next(null, null);
			}
		},
		(uid, next) => {
			if (!uid) {
				return next(null, null);
			}
			userController.getUserDataByUID(callerUid, uid, next);
		},
	], callback);
};

userController.getUserDataByUID = (callerUid, uid, callback) => {
	if (!parseInt(callerUid, 10) && parseInt(meta.config.privateUserInfo, 10) === 1) {
		return callback(new Error('[[error:no-privileges]]'));
	}

	if (!parseInt(uid, 10)) {
		return callback(new Error('[[error:no-user]]'));
	}

	async.parallel({
		userData: async.apply(user.getUserData, uid),
		settings: async.apply(user.getSettings, uid),
	}, (err, results) => {
		if (err || !results.userData) {
			return callback(err || new Error('[[error:no-user]]'));
		}

		results.userData.email = results.settings.showemail && parseInt(meta.config.hideEmail, 10) !== 1 ? results.userData.email : undefined;
		results.userData.fullname = results.settings.showfullname && parseInt(meta.config.hideFullname, 10) !== 1 ? results.userData.fullname : undefined;

		callback(null, results.userData);
	});
};
