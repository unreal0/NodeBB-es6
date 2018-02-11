var async = require('async');
var _ = require('lodash');

var user = require('../user');
var groups = require('../groups');
var plugins = require('../plugins');
var helpers = require('./helpers');

module.exports = (privileges) => {
	privileges.users = {};

	privileges.users.isAdministrator = (uid, callback) => {
		if (Array.isArray(uid)) {
			groups.isMembers(uid, 'administrators', callback);
		} else {
			groups.isMember(uid, 'administrators', callback);
		}
	};

	privileges.users.isGlobalModerator = (uid, callback) => {
		if (Array.isArray(uid)) {
			groups.isMembers(uid, 'Global Moderators', callback);
		} else {
			groups.isMember(uid, 'Global Moderators', callback);
		}
	};

	privileges.users.isModerator = (uid, cid, callback) => {
		if (Array.isArray(cid)) {
			isModeratorOfCategories(cid, uid, callback);
		} else if (Array.isArray(uid)) {
			isModeratorsOfCategory(cid, uid, callback);
		} else {
			isModeratorOfCategory(cid, uid, callback);
		}
	};

	function isModeratorOfCategories(cids, uid, callback) {
		if (!parseInt(uid, 10)) {
			return filterIsModerator(cids, uid, cids.map(() => false), callback);
		}
		var uniqueCids;
		async.waterfall([
			(next) => {
				privileges.users.isGlobalModerator(uid, next);
			},
			(isGlobalModerator, next) => {
				if (isGlobalModerator) {
					return filterIsModerator(cids, uid, cids.map(() => true), callback);
				}

				uniqueCids = _.uniq(cids);

				helpers.isUserAllowedTo('moderate', uid, uniqueCids, next);
			},
			(isAllowed, next) => {
				var map = {};

				uniqueCids.forEach((cid, index) => {
					map[cid] = isAllowed[index];
				});

				var isModerator = cids.map(cid => map[cid]);

				filterIsModerator(cids, uid, isModerator, next);
			},
		], callback);
	}

	function isModeratorsOfCategory(cid, uids, callback) {
		async.waterfall([
			(next) => {
				async.parallel([
					async.apply(privileges.users.isGlobalModerator, uids),
					async.apply(groups.isMembers, uids, 'cid:' + cid + ':privileges:moderate'),
					async.apply(groups.isMembersOfGroupList, uids, 'cid:' + cid + ':privileges:groups:moderate'),
				], next);
			},
			(checks, next) => {
				var isModerator = checks[0].map((isMember, idx) => isMember || checks[1][idx] || checks[2][idx]);

				filterIsModerator(cid, uids, isModerator, next);
			},
		], callback);
	}

	function isModeratorOfCategory(cid, uid, callback) {
		async.waterfall([
			(next) => {
				async.parallel([
					async.apply(privileges.users.isGlobalModerator, uid),
					async.apply(groups.isMember, uid, 'cid:' + cid + ':privileges:moderate'),
					async.apply(groups.isMemberOfGroupList, uid, 'cid:' + cid + ':privileges:groups:moderate'),
				], next);
			},
			(checks, next) => {
				var isModerator = checks[0] || checks[1] || checks[2];
				filterIsModerator(cid, uid, isModerator, next);
			},
		], callback);
	}

	function filterIsModerator(cid, uid, isModerator, callback) {
		async.waterfall([
			(next) => {
				plugins.fireHook('filter:user.isModerator', { uid: uid, cid: cid, isModerator: isModerator }, next);
			},
			(data, next) => {
				if ((Array.isArray(uid) || Array.isArray(cid)) && !Array.isArray(data.isModerator)) {
					return callback(new Error('filter:user.isModerator - i/o mismatch'));
				}

				next(null, data.isModerator);
			},
		], callback);
	}

	privileges.users.canEdit = (callerUid, uid, callback) => {
		if (parseInt(callerUid, 10) === parseInt(uid, 10)) {
			return process.nextTick(callback, null, true);
		}
		async.waterfall([
			(next) => {
				async.parallel({
					isAdmin: (next) => {
						privileges.users.isAdministrator(callerUid, next);
					},
					isGlobalMod: (next) => {
						privileges.users.isGlobalModerator(callerUid, next);
					},
					isTargetAdmin: (next) => {
						privileges.users.isAdministrator(uid, next);
					},
				}, next);
			},
			(results, next) => {
				results.canEdit = results.isAdmin || (results.isGlobalMod && !results.isTargetAdmin);
				results.callerUid = callerUid;
				results.uid = uid;
				plugins.fireHook('filter:user.canEdit', results, next);
			},
			(data, next) => {
				next(null, data.canEdit);
			},
		], callback);
	};

	privileges.users.canBanUser = (callerUid, uid, callback) => {
		async.waterfall([
			(next) => {
				async.parallel({
					isAdmin: (next) => {
						privileges.users.isAdministrator(callerUid, next);
					},
					isGlobalMod: (next) => {
						privileges.users.isGlobalModerator(callerUid, next);
					},
					isTargetAdmin: (next) => {
						privileges.users.isAdministrator(uid, next);
					},
				}, next);
			},
			(results, next) => {
				results.canBan = !results.isTargetAdmin && (results.isAdmin || results.isGlobalMod);
				results.callerUid = callerUid;
				results.uid = uid;
				plugins.fireHook('filter:user.canBanUser', results, next);
			},
			(data, next) => {
				next(null, data.canBan);
			},
		], callback);
	};

	privileges.users.hasBanPrivilege = (uid, callback) => {
		async.waterfall([
			(next) => {
				user.isAdminOrGlobalMod(uid, next);
			},
			(isAdminOrGlobalMod, next) => {
				plugins.fireHook('filter:user.hasBanPrivilege', {
					uid: uid,
					isAdminOrGlobalMod: isAdminOrGlobalMod,
					canBan: isAdminOrGlobalMod,
				}, next);
			},
			(data, next) => {
				next(null, data.canBan);
			},
		], callback);
	};
};
