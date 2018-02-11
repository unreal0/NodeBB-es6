var async = require('async');
var nconf = require('nconf');

var db = require('../database');
var Password = require('../password');

module.exports = (User) => {
	User.hashPassword = (password, callback) => {
		if (!password) {
			return callback(null, password);
		}

		Password.hash(nconf.get('bcrypt_rounds') || 12, password, callback);
	};

	User.isPasswordCorrect = (uid, password, callback) => {
		password = password || '';
		var hashedPassword;
		async.waterfall([
			(next) => {
				db.getObjectField('user:' + uid, 'password', next);
			},
			(_hashedPassword, next) => {
				hashedPassword = _hashedPassword;
				if (!hashedPassword) {
					return callback(null, true);
				}

				User.isPasswordValid(password, next);
			},
			(next) => {
				Password.compare(password, hashedPassword, next);
			},
		], callback);
	};

	User.hasPassword = (uid, callback) => {
		db.getObjectField('user:' + uid, 'password', (err, hashedPassword) => {
			callback(err, !!hashedPassword);
		});
	};
};
