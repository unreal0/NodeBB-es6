var async = require('async');
var request = require('request');
var winston = require('winston');
var validator = require('validator');

var db = require('../database');
var meta = require('../meta');
var emailer = require('../emailer');
var notifications = require('../notifications');
var groups = require('../groups');
var translator = require('../translator');
var utils = require('../utils');
var plugins = require('../plugins');

module.exports = (User) => {
	User.addToApprovalQueue = (userData, callback) => {
		userData.userslug = utils.slugify(userData.username);
		async.waterfall([
			(next) => {
				User.isDataValid(userData, next);
			},
			(next) => {
				User.hashPassword(userData.password, next);
			},
			(hashedPassword, next) => {
				var data = {
					username: userData.username,
					email: userData.email,
					ip: userData.ip,
					hashedPassword: hashedPassword,
				};
				plugins.fireHook('filter:user.addToApprovalQueue', { data: data, userData: userData }, next);
			},
			(results, next) => {
				db.setObject('registration:queue:name:' + userData.username, results.data, next);
			},
			(next) => {
				db.sortedSetAdd('registration:queue', Date.now(), userData.username, next);
			},
			(next) => {
				sendNotificationToAdmins(userData.username, next);
			},
		], callback);
	};

	function sendNotificationToAdmins(username, callback) {
		async.waterfall([
			(next) => {
				notifications.create({
					type: 'new-register',
					bodyShort: '[[notifications:new_register, ' + username + ']]',
					nid: 'new_register:' + username,
					path: '/admin/manage/registration',
					mergeId: 'new_register',
				}, next);
			},
			(notification, next) => {
				notifications.pushGroup(notification, 'administrators', next);
			},
		], callback);
	}

	User.acceptRegistration = (username, callback) => {
		var uid;
		var userData;
		async.waterfall([
			(next) => {
				db.getObject('registration:queue:name:' + username, next);
			},
			(_userData, next) => {
				if (!_userData) {
					return callback(new Error('[[error:invalid-data]]'));
				}
				userData = _userData;
				User.create(userData, next);
			},
			(_uid, next) => {
				uid = _uid;
				User.setUserField(uid, 'password', userData.hashedPassword, next);
			},
			(next) => {
				removeFromQueue(username, next);
			},
			(next) => {
				markNotificationRead(username, next);
			},
			(next) => {
				var title = meta.config.title || meta.config.browserTitle || 'NodeBB';
				translator.translate('[[email:welcome-to, ' + title + ']]', meta.config.defaultLang, (subject) => {
					var data = {
						username: username,
						subject: subject,
						template: 'registration_accepted',
						uid: uid,
					};

					emailer.send('registration_accepted', uid, data, next);
				});
			},
			(next) => {
				next(null, uid);
			},
		], callback);
	};

	function markNotificationRead(username, callback) {
		var nid = 'new_register:' + username;
		async.waterfall([
			(next) => {
				groups.getMembers('administrators', 0, -1, next);
			},
			(uids, next) => {
				async.each(uids, (uid, next) => {
					notifications.markRead(nid, uid, next);
				}, next);
			},
		], callback);
	}

	User.rejectRegistration = (username, callback) => {
		async.waterfall([
			(next) => {
				removeFromQueue(username, next);
			},
			(next) => {
				markNotificationRead(username, next);
			},
		], callback);
	};

	function removeFromQueue(username, callback) {
		async.parallel([
			async.apply(db.sortedSetRemove, 'registration:queue', username),
			async.apply(db.delete, 'registration:queue:name:' + username),
		], (err) => {
			callback(err);
		});
	}

	User.shouldQueueUser = (ip, callback) => {
		var registrationType = meta.config.registrationType || 'normal';
		if (registrationType === 'normal' || registrationType === 'invite-only' || registrationType === 'admin-invite-only') {
			setImmediate(callback, null, false);
		} else if (registrationType === 'admin-approval') {
			setImmediate(callback, null, true);
		} else if (registrationType === 'admin-approval-ip') {
			db.sortedSetCard('ip:' + ip + ':uid', (err, count) => {
				callback(err, !!count);
			});
		}
	};

	User.getRegistrationQueue = (start, stop, callback) => {
		var data;
		async.waterfall([
			(next) => {
				db.getSortedSetRevRangeWithScores('registration:queue', start, stop, next);
			},
			(_data, next) => {
				data = _data;
				var keys = data.filter(Boolean).map(user => (
					'registration:queue:name:' + user.value
				));
				db.getObjects(keys, next);
			},
			(users, next) => {
				users = users.filter(Boolean).map((user, index) => {
					user.timestampISO = utils.toISOString(data[index].score);
					user.email = validator.escape(String(user.email));
					delete user.hashedPassword;
					return user;
				});

				async.map(users, (user, next) => {
					// temporary: see http://www.stopforumspam.com/forum/viewtopic.php?id=6392
					user.ip = user.ip.replace('::ffff:', '');

					async.parallel([
						(next) => {
							getIPMatchedUsers(user, next);
						},
						(next) => {
							getSpamData(user, next);
						},
					], (err) => {
						next(err, user);
					});
				}, next);
			},
			(users, next) => {
				plugins.fireHook('filter:user.getRegistrationQueue', { users: users }, next);
			},
			(results, next) => {
				next(null, results.users);
			},
		], callback);
	};

	function getIPMatchedUsers(user, callback) {
		async.waterfall([
			(next) => {
				User.getUidsFromSet('ip:' + user.ip + ':uid', 0, -1, next);
			},
			(uids, next) => {
				User.getUsersFields(uids, ['uid', 'username', 'picture'], next);
			},
			(data, next) => {
				user.ipMatch = data;
				next();
			},
		], callback);
	}

	function getSpamData(user, callback) {
		async.waterfall([
			(next) => {
				request({
					method: 'get',
					url: 'http://api.stopforumspam.org/api' +
						'?ip=' + encodeURIComponent(user.ip) +
						'&email=' + encodeURIComponent(user.email) +
						'&username=' + encodeURIComponent(user.username) +
						'&f=json',
					json: true,
				}, next);
			},
			(response, body, next) => {
				if (response.statusCode === 200 && body) {
					user.spamData = body;
					user.usernameSpam = body.username ? (body.username.frequency > 0 || body.username.appears > 0) : true;
					user.emailSpam = body.email ? (body.email.frequency > 0 || body.email.appears > 0) : true;
					user.ipSpam = body.ip ? (body.ip.frequency > 0 || body.ip.appears > 0) : true;
				}
				next();
			},
		], (err) => {
			if (err) {
				winston.error(err);
			}
			callback();
		});
	}
};
