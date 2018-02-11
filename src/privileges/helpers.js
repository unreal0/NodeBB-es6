var async = require('async');
var _ = require('lodash');

var groups = require('../groups');
var user = require('../user');
var plugins = require('../plugins');

var helpers = module.exports;

helpers.some = (tasks, callback) => {
	async.some(tasks, (task, next) => {
		task(next);
	}, callback);
};

helpers.isUserAllowedTo = (privilege, uid, cid, callback) => {
	if (Array.isArray(privilege) && !Array.isArray(cid)) {
		isUserAllowedToPrivileges(privilege, uid, cid, callback);
	} else if (Array.isArray(cid) && !Array.isArray(privilege)) {
		isUserAllowedToCids(privilege, uid, cid, callback);
	} else {
		return callback(new Error('[[error:invalid-data]]'));
	}
};

function isUserAllowedToCids(privilege, uid, cids, callback) {
	if (parseInt(uid, 10) === 0) {
		return isGuestAllowedToCids(privilege, cids, callback);
	}

	var userKeys = [];
	var groupKeys = [];
	cids.forEach((cid) => {
		userKeys.push('cid:' + cid + ':privileges:' + privilege);
		groupKeys.push('cid:' + cid + ':privileges:groups:' + privilege);
	});

	checkIfAllowed(uid, userKeys, groupKeys, callback);
}

function isUserAllowedToPrivileges(privileges, uid, cid, callback) {
	if (parseInt(uid, 10) === 0) {
		return isGuestAllowedToPrivileges(privileges, cid, callback);
	}

	var userKeys = [];
	var groupKeys = [];
	privileges.forEach((privilege) => {
		userKeys.push('cid:' + cid + ':privileges:' + privilege);
		groupKeys.push('cid:' + cid + ':privileges:groups:' + privilege);
	});

	checkIfAllowed(uid, userKeys, groupKeys, callback);
}

function checkIfAllowed(uid, userKeys, groupKeys, callback) {
	async.waterfall([
		(next) => {
			async.parallel({
				hasUserPrivilege: (next) => {
					groups.isMemberOfGroups(uid, userKeys, next);
				},
				hasGroupPrivilege: (next) => {
					groups.isMemberOfGroupsList(uid, groupKeys, next);
				},
			}, next);
		},
		(results, next) => {
			var result = userKeys.map((key, index) => results.hasUserPrivilege[index] || results.hasGroupPrivilege[index]);

			next(null, result);
		},
	], callback);
}

helpers.isUsersAllowedTo = (privilege, uids, cid, callback) => {
	async.waterfall([
		(next) => {
			async.parallel({
				hasUserPrivilege: (next) => {
					groups.isMembers(uids, 'cid:' + cid + ':privileges:' + privilege, next);
				},
				hasGroupPrivilege: (next) => {
					groups.isMembersOfGroupList(uids, 'cid:' + cid + ':privileges:groups:' + privilege, next);
				},
			}, next);
		},
		(results, next) => {
			var result = uids.map((uid, index) => results.hasUserPrivilege[index] || results.hasGroupPrivilege[index]);

			next(null, result);
		},
	], callback);
};

function isGuestAllowedToCids(privilege, cids, callback) {
	var groupKeys = cids.map(cid => 'cid:' + cid + ':privileges:groups:' + privilege);

	groups.isMemberOfGroups('guests', groupKeys, callback);
}

function isGuestAllowedToPrivileges(privileges, cid, callback) {
	var groupKeys = privileges.map(privilege => 'cid:' + cid + ':privileges:groups:' + privilege);

	groups.isMemberOfGroups('guests', groupKeys, callback);
}

helpers.getUserPrivileges = (cid, hookName, userPrivilegeList, callback) => {
	var userPrivileges;
	var memberSets;
	async.waterfall([
		async.apply(plugins.fireHook, hookName, userPrivilegeList.slice()),
		(_privs, next) => {
			userPrivileges = _privs;
			groups.getMembersOfGroups(userPrivileges.map(privilege => 'cid:' + cid + ':privileges:' + privilege), next);
		},
		(_memberSets, next) => {
			memberSets = _memberSets.map(set => set.map(uid => parseInt(uid, 10)));

			var members = _.uniq(_.flatten(memberSets));

			user.getUsersFields(members, ['picture', 'username'], next);
		},
		(memberData, next) => {
			memberData.forEach((member) => {
				member.privileges = {};
				for (var x = 0, numPrivs = userPrivileges.length; x < numPrivs; x += 1) {
					member.privileges[userPrivileges[x]] = memberSets[x].indexOf(parseInt(member.uid, 10)) !== -1;
				}
			});

			next(null, memberData);
		},
	], callback);
};

helpers.getGroupPrivileges = (cid, hookName, groupPrivilegeList, callback) => {
	var groupPrivileges;
	async.waterfall([
		async.apply(plugins.fireHook, hookName, groupPrivilegeList.slice()),
		(_privs, next) => {
			groupPrivileges = _privs;
			async.parallel({
				memberSets: (next) => {
					groups.getMembersOfGroups(groupPrivileges.map(privilege => 'cid:' + cid + ':privileges:' + privilege), next);
				},
				groupNames: (next) => {
					groups.getGroups('groups:createtime', 0, -1, next);
				},
			}, next);
		},
		(results, next) => {
			var memberSets = results.memberSets;
			var uniqueGroups = _.uniq(_.flatten(memberSets));

			var groupNames = results.groupNames.filter(groupName => groupName.indexOf(':privileges:') === -1 && uniqueGroups.indexOf(groupName) !== -1);

			groupNames = groups.ephemeralGroups.concat(groupNames);
			var registeredUsersIndex = groupNames.indexOf('registered-users');
			if (registeredUsersIndex !== -1) {
				groupNames.splice(0, 0, groupNames.splice(registeredUsersIndex, 1)[0]);
			} else {
				groupNames = ['registered-users'].concat(groupNames);
			}

			var adminIndex = groupNames.indexOf('administrators');
			if (adminIndex !== -1) {
				groupNames.splice(adminIndex, 1);
			}

			var memberPrivs;

			var memberData = groupNames.map((member) => {
				memberPrivs = {};

				for (var x = 0, numPrivs = groupPrivileges.length; x < numPrivs; x += 1) {
					memberPrivs[groupPrivileges[x]] = memberSets[x].indexOf(member) !== -1;
				}
				return {
					name: member,
					privileges: memberPrivs,
				};
			});

			next(null, memberData);
		},
		(memberData, next) => {
			// Grab privacy info for the groups as well
			async.map(memberData, (member, next) => {
				async.waterfall([
					(next) => {
						groups.isPrivate(member.name, next);
					},
					(isPrivate, next) => {
						member.isPrivate = isPrivate;
						next(null, member);
					},
				], next);
			}, next);
		},
	], callback);
};

helpers.giveOrRescind = (method, privileges, cid, groupName, callback) => {
	async.eachSeries(privileges, (privilege, next) => {
		method('cid:' + cid + ':privileges:groups:' + privilege, groupName, next);
	}, callback);
};
