

var async = require('async');
var _ = require('lodash');

var groups = require('./groups');
var plugins = require('./plugins');
var db = require('./database');
var privileges = require('./privileges');
var meta = require('./meta');

var User = module.exports;

User.email = require('./user/email');
User.notifications = require('./user/notifications');
User.reset = require('./user/reset');
User.digest = require('./user/digest');

require('./user/data')(User);
require('./user/auth')(User);
require('./user/bans')(User);
require('./user/create')(User);
require('./user/posts')(User);
require('./user/topics')(User);
require('./user/categories')(User);
require('./user/follow')(User);
require('./user/profile')(User);
require('./user/admin')(User);
require('./user/delete')(User);
require('./user/settings')(User);
require('./user/search')(User);
require('./user/jobs')(User);
require('./user/picture')(User);
require('./user/approval')(User);
require('./user/invite')(User);
require('./user/password')(User);
require('./user/info')(User);
require('./user/online')(User);

User.getUidsFromSet = (set, start, stop, callback) => {
	if (set === 'users:online') {
		var count = parseInt(stop, 10) === -1 ? stop : stop - start + 1;
		var now = Date.now();
		db.getSortedSetRevRangeByScore(set, start, count, '+inf', now - 300000, callback);
	} else {
		db.getSortedSetRevRange(set, start, stop, callback);
	}
};

User.getUsersFromSet = (set, uid, start, stop, callback) => {
	async.waterfall([
		(next) => {
			User.getUidsFromSet(set, start, stop, next);
		},
		(uids, next) => {
			User.getUsers(uids, uid, next);
		},
	], callback);
};

User.getUsersWithFields = (uids, fields, uid, callback) => {
	async.waterfall([
		(next) => {
			plugins.fireHook('filter:users.addFields', { fields: fields }, next);
		},
		(data, next) => {
			data.fields = _.uniq(data.fields);

			async.parallel({
				userData: (next) => {
					User.getUsersFields(uids, data.fields, next);
				},
				isAdmin: (next) => {
					User.isAdministrator(uids, next);
				},
			}, next);
		},
		(results, next) => {
			results.userData.forEach((user, index) => {
				if (user) {
					user.administrator = results.isAdmin[index];

					if (user.hasOwnProperty('status')) {
						user.status = User.getStatus(user);
					}

					if (user.hasOwnProperty('banned')) {
						user.banned = parseInt(user.banned, 10) === 1;
					}

					if (user.hasOwnProperty(['email:confirmed'])) {
						user['email:confirmed'] = parseInt(user['email:confirmed'], 10) === 1;
					}
				}
			});
			plugins.fireHook('filter:userlist.get', { users: results.userData, uid: uid }, next);
		},
		(data, next) => {
			next(null, data.users);
		},
	], callback);
};

User.getUsers = (uids, uid, callback) => {
	User.getUsersWithFields(uids, [
		'uid', 'username', 'userslug', 'picture', 'status',
		'postcount', 'reputation', 'email:confirmed', 'lastonline',
		'flags', 'banned', 'banned:expire', 'joindate',
	], uid, callback);
};

User.getStatus = (userData) => {
	var isOnline = (Date.now() - parseInt(userData.lastonline, 10)) < 300000;
	return isOnline ? (userData.status || 'online') : 'offline';
};

User.exists = (uid, callback) => {
	db.isSortedSetMember('users:joindate', uid, callback);
};

User.existsBySlug = (userslug, callback) => {
	User.getUidByUserslug(userslug, (err, exists) => {
		callback(err, !!exists);
	});
};

User.getUidByUsername = (username, callback) => {
	if (!username) {
		return callback(null, 0);
	}
	db.sortedSetScore('username:uid', username, callback);
};

User.getUidsByUsernames = (usernames, callback) => {
	db.sortedSetScores('username:uid', usernames, callback);
};

User.getUidByUserslug = (userslug, callback) => {
	if (!userslug) {
		return callback(null, 0);
	}
	db.sortedSetScore('userslug:uid', userslug, callback);
};

User.getUsernamesByUids = (uids, callback) => {
	async.waterfall([
		(next) => {
			User.getUsersFields(uids, ['username'], next);
		},
		(users, next) => {
			users = users.map(user => user.username);

			next(null, users);
		},
	], callback);
};

User.getUsernameByUserslug = (slug, callback) => {
	async.waterfall([
		(next) => {
			User.getUidByUserslug(slug, next);
		},
		(uid, next) => {
			User.getUserField(uid, 'username', next);
		},
	], callback);
};

User.getUidByEmail = (email, callback) => {
	db.sortedSetScore('email:uid', email.toLowerCase(), callback);
};

User.getUidsByEmails = (emails, callback) => {
	emails = emails.map(email => email && email.toLowerCase());
	db.sortedSetScores('email:uid', emails, callback);
};

User.getUsernameByEmail = (email, callback) => {
	async.waterfall([
		(next) => {
			db.sortedSetScore('email:uid', email.toLowerCase(), next);
		},
		(uid, next) => {
			User.getUserField(uid, 'username', next);
		},
	], callback);
};

User.isModerator = (uid, cid, callback) => {
	privileges.users.isModerator(uid, cid, callback);
};

User.isModeratorOfAnyCategory = (uid, callback) => {
	User.getModeratedCids(uid, (err, cids) => {
		callback(err, Array.isArray(cids) ? !!cids.length : false);
	});
};

User.isAdministrator = (uid, callback) => {
	privileges.users.isAdministrator(uid, callback);
};

User.isGlobalModerator = (uid, callback) => {
	privileges.users.isGlobalModerator(uid, callback);
};

User.getPrivileges = (uid, callback) => {
	async.parallel({
		isAdmin: async.apply(User.isAdministrator, uid),
		isGlobalModerator: async.apply(User.isGlobalModerator, uid),
		isModeratorOfAnyCategory: async.apply(User.isModeratorOfAnyCategory, uid),
	}, callback);
};

User.isPrivileged = (uid, callback) => {
	User.getPrivileges(uid, (err, results) => {
		callback(err, results ? (results.isAdmin || results.isGlobalModerator || results.isModeratorOfAnyCategory) : false);
	});
};

User.isAdminOrGlobalMod = (uid, callback) => {
	async.parallel({
		isAdmin: async.apply(User.isAdministrator, uid),
		isGlobalMod: async.apply(User.isGlobalModerator, uid),
	}, (err, results) => {
		callback(err, results ? (results.isAdmin || results.isGlobalMod) : false);
	});
};

User.isAdminOrSelf = (callerUid, uid, callback) => {
	isSelfOrMethod(callerUid, uid, User.isAdministrator, callback);
};

User.isAdminOrGlobalModOrSelf = (callerUid, uid, callback) => {
	isSelfOrMethod(callerUid, uid, User.isAdminOrGlobalMod, callback);
};

User.isPrivilegedOrSelf = (callerUid, uid, callback) => {
	isSelfOrMethod(callerUid, uid, User.isPrivileged, callback);
};

function isSelfOrMethod(callerUid, uid, method, callback) {
	if (parseInt(callerUid, 10) === parseInt(uid, 10)) {
		return callback();
	}
	async.waterfall([
		(next) => {
			method(callerUid, next);
		},
		(isPass, next) => {
			if (!isPass) {
				return next(new Error('[[error:no-privileges]]'));
			}
			next();
		},
	], callback);
}

User.getAdminsandGlobalMods = (callback) => {
	async.waterfall([
		(next) => {
			async.parallel([
				async.apply(groups.getMembers, 'administrators', 0, -1),
				async.apply(groups.getMembers, 'Global Moderators', 0, -1),
			], next);
		},
		(results, next) => {
			User.getUsersData(_.union(results), next);
		},
	], callback);
};

User.getAdminsandGlobalModsandModerators = (callback) => {
	async.waterfall([
		(next) => {
			async.parallel([
				async.apply(groups.getMembers, 'administrators', 0, -1),
				async.apply(groups.getMembers, 'Global Moderators', 0, -1),
				async.apply(User.getModeratorUids),
			], next);
		},
		(results, next) => {
			User.getUsersData(_.union.apply(_, results), next);
		},
	], callback);
};

User.getModeratorUids = (callback) => {
	async.waterfall([
		async.apply(db.getSortedSetRange, 'categories:cid', 0, -1),
		(cids, next) => {
			var groupNames = cids.reduce((memo, cid) => {
				memo.push('cid:' + cid + ':privileges:moderate');
				memo.push('cid:' + cid + ':privileges:groups:moderate');
				return memo;
			}, []);

			groups.getMembersOfGroups(groupNames, next);
		},
		(memberSets, next) => {
			// Every other set is actually a list of user groups, not uids, so convert those to members
			var sets = memberSets.reduce((memo, set, idx) => {
				if (idx % 2) {
					memo.working.push(set);
				} else {
					memo.regular.push(set);
				}

				return memo;
			}, { working: [], regular: [] });

			groups.getMembersOfGroups(sets.working, (err, memberSets) => {
				next(err, sets.regular.concat(memberSets || []));
			});
		},
		(memberSets, next) => {
			next(null, _.union.apply(_, memberSets));
		},
	], callback);
};

User.getModeratedCids = (uid, callback) => {
	var cids;
	async.waterfall([
		(next) => {
			db.getSortedSetRange('categories:cid', 0, -1, next);
		},
		(_cids, next) => {
			cids = _cids;
			User.isModerator(uid, cids, next);
		},
		(isMods, next) => {
			cids = cids.filter((cid, index) => cid && isMods[index]);
			next(null, cids);
		},
	], callback);
};

User.addInterstitials = (callback) => {
	plugins.registerHook('core', {
		hook: 'filter:register.interstitial',
		method: (data, callback) => {
			if (meta.config.termsOfUse && !data.userData.acceptTos) {
				data.interstitials.push({
					template: 'partials/acceptTos',
					data: {
						termsOfUse: meta.config.termsOfUse,
					},
					callback: (userData, formData, next) => {
						if (formData['agree-terms'] === 'on') {
							userData.acceptTos = true;
						}

						next(userData.acceptTos ? null : new Error('[[register:terms_of_use_error]]'));
					},
				});
			}

			callback(null, data);
		},
	});

	callback();
};

