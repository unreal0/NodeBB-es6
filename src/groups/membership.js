var async = require('async');
var winston = require('winston');
var _ = require('lodash');

var user = require('../user');
var utils = require('../utils');
var plugins = require('../plugins');
var notifications = require('../notifications');
var db = require('../database');

var pubsub = require('../pubsub');
var LRU = require('lru-cache');

var cache = LRU({
	max: 40000,
	maxAge: 0,
});

module.exports = (Groups) => {
	Groups.cache = cache;

	Groups.join = (groupName, uid, callback) => {
		callback = callback || function () {};

		if (!groupName) {
			return callback(new Error('[[error:invalid-data]]'));
		}

		if (!uid) {
			return callback(new Error('[[error:invalid-uid]]'));
		}

		async.waterfall([
			(next) => {
				Groups.isMember(uid, groupName, next);
			},
			(isMember, next) => {
				if (isMember) {
					return callback();
				}
				Groups.exists(groupName, next);
			},
			(exists, next) => {
				if (exists) {
					return next();
				}
				Groups.create({
					name: groupName,
					description: '',
					hidden: 1,
				}, (err) => {
					if (err && err.message !== '[[error:group-already-exists]]') {
						winston.error('[groups.join] Could not create new hidden group', err);
						return callback(err);
					}
					next();
				});
			},
			(next) => {
				async.parallel({
					isAdmin: (next) => {
						user.isAdministrator(uid, next);
					},
					isHidden: (next) => {
						Groups.isHidden(groupName, next);
					},
				}, next);
			},
			(results, next) => {
				var tasks = [
					async.apply(db.sortedSetAdd, 'group:' + groupName + ':members', Date.now(), uid),
					async.apply(db.incrObjectField, 'group:' + groupName, 'memberCount'),
				];
				if (results.isAdmin) {
					tasks.push(async.apply(db.setAdd, 'group:' + groupName + ':owners', uid));
				}
				if (!results.isHidden) {
					tasks.push(async.apply(db.sortedSetIncrBy, 'groups:visible:memberCount', 1, groupName));
				}
				async.parallel(tasks, next);
			},
			(results, next) => {
				clearCache(uid, groupName);
				setGroupTitleIfNotSet(groupName, uid, next);
			},
			(next) => {
				plugins.fireHook('action:group.join', {
					groupName: groupName,
					uid: uid,
				});
				next();
			},
		], callback);
	};

	function setGroupTitleIfNotSet(groupName, uid, callback) {
		if (groupName === 'registered-users' || Groups.isPrivilegeGroup(groupName)) {
			return callback();
		}

		db.getObjectField('user:' + uid, 'groupTitle', (err, currentTitle) => {
			if (err || (currentTitle || currentTitle === '')) {
				return callback(err);
			}

			user.setUserField(uid, 'groupTitle', groupName, callback);
		});
	}

	Groups.requestMembership = (groupName, uid, callback) => {
		async.waterfall([
			async.apply(inviteOrRequestMembership, groupName, uid, 'request'),
			(next) => {
				user.getUserField(uid, 'username', next);
			},
			(username, next) => {
				async.parallel({
					notification: (next) => {
						notifications.create({
							bodyShort: '[[groups:request.notification_title, ' + username + ']]',
							bodyLong: '[[groups:request.notification_text, ' + username + ', ' + groupName + ']]',
							nid: 'group:' + groupName + ':uid:' + uid + ':request',
							path: '/groups/' + utils.slugify(groupName),
							from: uid,
						}, next);
					},
					owners: (next) => {
						Groups.getOwners(groupName, next);
					},
				}, next);
			},
			(results, next) => {
				if (!results.notification || !results.owners.length) {
					return next();
				}
				notifications.push(results.notification, results.owners, next);
			},
		], callback);
	};

	Groups.acceptMembership = (groupName, uid, callback) => {
		async.waterfall([
			async.apply(db.setRemove, 'group:' + groupName + ':pending', uid),
			async.apply(db.setRemove, 'group:' + groupName + ':invited', uid),
			async.apply(Groups.join, groupName, uid),
		], callback);
	};

	Groups.rejectMembership = (groupName, uid, callback) => {
		async.parallel([
			async.apply(db.setRemove, 'group:' + groupName + ':pending', uid),
			async.apply(db.setRemove, 'group:' + groupName + ':invited', uid),
		], (err) => {
			callback(err);
		});
	};

	Groups.invite = (groupName, uid, callback) => {
		async.waterfall([
			async.apply(inviteOrRequestMembership, groupName, uid, 'invite'),
			async.apply(notifications.create, {
				type: 'group-invite',
				bodyShort: '[[groups:invited.notification_title, ' + groupName + ']]',
				bodyLong: '',
				nid: 'group:' + groupName + ':uid:' + uid + ':invite',
				path: '/groups/' + utils.slugify(groupName),
			}),
			(notification, next) => {
				notifications.push(notification, [uid], next);
			},
		], callback);
	};

	function inviteOrRequestMembership(groupName, uid, type, callback) {
		if (!parseInt(uid, 10)) {
			return callback(new Error('[[error:not-logged-in]]'));
		}
		var hookName = type === 'invite' ? 'action:group.inviteMember' : 'action:group.requestMembership';
		var set = type === 'invite' ? 'group:' + groupName + ':invited' : 'group:' + groupName + ':pending';

		async.waterfall([
			(next) => {
				async.parallel({
					exists: async.apply(Groups.exists, groupName),
					isMember: async.apply(Groups.isMember, uid, groupName),
					isPending: async.apply(Groups.isPending, uid, groupName),
					isInvited: async.apply(Groups.isInvited, uid, groupName),
				}, next);
			},
			(checks, next) => {
				if (!checks.exists) {
					return next(new Error('[[error:no-group]]'));
				} else if (checks.isMember) {
					return callback();
				} else if (type === 'invite' && checks.isInvited) {
					return callback();
				} else if (type === 'request' && checks.isPending) {
					return next(new Error('[[error:group-already-requested]]'));
				}

				db.setAdd(set, uid, next);
			},
			(next) => {
				plugins.fireHook(hookName, {
					groupName: groupName,
					uid: uid,
				});
				next();
			},
		], callback);
	}

	Groups.leave = (groupName, uid, callback) => {
		callback = callback || function () {};

		async.waterfall([
			(next) => {
				Groups.isMember(uid, groupName, next);
			},
			(isMember, next) => {
				if (!isMember) {
					return callback();
				}

				Groups.exists(groupName, next);
			},
			(exists, next) => {
				if (!exists) {
					return callback();
				}
				async.parallel([
					async.apply(db.sortedSetRemove, 'group:' + groupName + ':members', uid),
					async.apply(db.setRemove, 'group:' + groupName + ':owners', uid),
					async.apply(db.decrObjectField, 'group:' + groupName, 'memberCount'),
				], next);
			},
			(results, next) => {
				clearCache(uid, groupName);
				Groups.getGroupFields(groupName, ['hidden', 'memberCount'], next);
			},
			(groupData, next) => {
				if (!groupData) {
					return callback();
				}
				if (Groups.isPrivilegeGroup(groupName) && parseInt(groupData.memberCount, 10) === 0) {
					Groups.destroy(groupName, next);
				} else if (parseInt(groupData.hidden, 10) !== 1) {
					db.sortedSetAdd('groups:visible:memberCount', groupData.memberCount, groupName, next);
				} else {
					next();
				}
			},
			(next) => {
				clearGroupTitleIfSet(groupName, uid, next);
			},
			(next) => {
				plugins.fireHook('action:group.leave', {
					groupName: groupName,
					uid: uid,
				});
				next();
			},
		], callback);
	};

	function clearGroupTitleIfSet(groupName, uid, callback) {
		if (groupName === 'registered-users' || Groups.isPrivilegeGroup(groupName)) {
			return callback();
		}
		async.waterfall([
			(next) => {
				db.getObjectField('user:' + uid, 'groupTitle', next);
			},
			(groupTitle, next) => {
				if (groupTitle === groupName) {
					db.deleteObjectField('user:' + uid, 'groupTitle', next);
				} else {
					next();
				}
			},
		], callback);
	}

	Groups.leaveAllGroups = (uid, callback) => {
		async.waterfall([
			(next) => {
				db.getSortedSetRange('groups:createtime', 0, -1, next);
			},
			(groups, next) => {
				async.each(groups, (groupName, next) => {
					async.parallel([
						(next) => {
							Groups.isMember(uid, groupName, (err, isMember) => {
								if (!err && isMember) {
									Groups.leave(groupName, uid, next);
								} else {
									next();
								}
							});
						},
						(next) => {
							Groups.rejectMembership(groupName, uid, next);
						},
					], next);
				}, next);
			},
		], callback);
	};

	Groups.getMembers = (groupName, start, stop, callback) => {
		db.getSortedSetRevRange('group:' + groupName + ':members', start, stop, callback);
	};

	Groups.getMemberUsers = (groupNames, start, stop, callback) => {
		async.map(groupNames, (groupName, next) => {
			async.waterfall([
				(next) => {
					Groups.getMembers(groupName, start, stop, next);
				},
				(uids, next) => {
					user.getUsersFields(uids, ['uid', 'username', 'picture', 'userslug'], next);
				},
			], next);
		}, callback);
	};

	Groups.getMembersOfGroups = (groupNames, callback) => {
		db.getSortedSetsMembers(groupNames.map(name => 'group:' + name + ':members'), callback);
	};

	Groups.resetCache = () => {
		pubsub.publish('group:cache:reset');
		cache.reset();
	};

	pubsub.on('group:cache:reset', () => {
		cache.reset();
	});

	function clearCache(uid, groupName) {
		pubsub.publish('group:cache:del', { uid: uid, groupName: groupName });
		cache.del(uid + ':' + groupName);
	}

	pubsub.on('group:cache:del', (data) => {
		cache.del(data.uid + ':' + data.groupName);
	});

	Groups.isMember = (uid, groupName, callback) => {
		if (!uid || parseInt(uid, 10) <= 0 || !groupName) {
			return setImmediate(callback, null, false);
		}

		var cacheKey = uid + ':' + groupName;
		var isMember = cache.get(cacheKey);
		if (isMember !== undefined) {
			return setImmediate(callback, null, isMember);
		}

		async.waterfall([
			(next) => {
				db.isSortedSetMember('group:' + groupName + ':members', uid, next);
			},
			(isMember, next) => {
				cache.set(cacheKey, isMember);
				next(null, isMember);
			},
		], callback);
	};

	Groups.isMembers = (uids, groupName, callback) => {
		var cachedData = {};
		function getFromCache() {
			setImmediate(callback, null, uids.map(uid => cachedData[uid + ':' + groupName]));
		}

		if (!groupName || !uids.length) {
			return callback(null, uids.map(() => false));
		}

		var nonCachedUids = uids.filter((uid) => {
			var isMember = cache.get(uid + ':' + groupName);
			if (isMember !== undefined) {
				cachedData[uid + ':' + groupName] = isMember;
			}
			return isMember === undefined;
		});

		if (!nonCachedUids.length) {
			return getFromCache(callback);
		}

		async.waterfall([
			(next) => {
				db.isSortedSetMembers('group:' + groupName + ':members', nonCachedUids, next);
			},
			(isMembers, next) => {
				nonCachedUids.forEach((uid, index) => {
					cachedData[uid + ':' + groupName] = isMembers[index];
					cache.set(uid + ':' + groupName, isMembers[index]);
				});

				getFromCache(next);
			},
		], callback);
	};

	Groups.isMemberOfGroups = (uid, groups, callback) => {
		var cachedData = {};
		function getFromCache(next) {
			setImmediate(next, null, groups.map(groupName => cachedData[uid + ':' + groupName]));
		}

		if (!uid || parseInt(uid, 10) <= 0 || !groups.length) {
			return callback(null, groups.map(() => false));
		}

		var nonCachedGroups = groups.filter((groupName) => {
			var isMember = cache.get(uid + ':' + groupName);
			if (isMember !== undefined) {
				cachedData[uid + ':' + groupName] = isMember;
			}
			return isMember === undefined;
		});

		if (!nonCachedGroups.length) {
			return getFromCache(callback);
		}

		var nonCachedGroupsMemberSets = nonCachedGroups.map(groupName => 'group:' + groupName + ':members');

		async.waterfall([
			(next) => {
				db.isMemberOfSortedSets(nonCachedGroupsMemberSets, uid, next);
			},
			(isMembers, next) => {
				nonCachedGroups.forEach((groupName, index) => {
					cachedData[uid + ':' + groupName] = isMembers[index];
					cache.set(uid + ':' + groupName, isMembers[index]);
				});

				getFromCache(next);
			},
		], callback);
	};

	Groups.getMemberCount = (groupName, callback) => {
		async.waterfall([
			(next) => {
				db.getObjectField('group:' + groupName, 'memberCount', next);
			},
			(count, next) => {
				next(null, parseInt(count, 10));
			},
		], callback);
	};

	Groups.isMemberOfGroupList = (uid, groupListKey, callback) => {
		async.waterfall([
			(next) => {
				db.getSortedSetRange('group:' + groupListKey + ':members', 0, -1, next);
			},
			(groupNames, next) => {
				groupNames = Groups.removeEphemeralGroups(groupNames);
				if (groupNames.length === 0) {
					return callback(null, false);
				}

				Groups.isMemberOfGroups(uid, groupNames, next);
			},
			(isMembers, next) => {
				next(null, isMembers.indexOf(true) !== -1);
			},
		], callback);
	};

	Groups.isMemberOfGroupsList = (uid, groupListKeys, callback) => {
		var sets = groupListKeys.map(groupName => 'group:' + groupName + ':members');

		var uniqueGroups;
		var members;
		async.waterfall([
			(next) => {
				db.getSortedSetsMembers(sets, next);
			},
			(_members, next) => {
				members = _members;
				uniqueGroups = _.uniq(_.flatten(members));
				uniqueGroups = Groups.removeEphemeralGroups(uniqueGroups);

				Groups.isMemberOfGroups(uid, uniqueGroups, next);
			},
			(isMembers, next) => {
				var map = {};

				uniqueGroups.forEach((groupName, index) => {
					map[groupName] = isMembers[index];
				});

				var result = members.map((groupNames) => {
					for (var i = 0; i < groupNames.length; i += 1) {
						if (map[groupNames[i]]) {
							return true;
						}
					}
					return false;
				});

				next(null, result);
			},
		], callback);
	};

	Groups.isMembersOfGroupList = (uids, groupListKey, callback) => {
		var groupNames;
		var results = [];
		uids.forEach(() => {
			results.push(false);
		});

		async.waterfall([
			(next) => {
				db.getSortedSetRange('group:' + groupListKey + ':members', 0, -1, next);
			},
			(_groupNames, next) => {
				groupNames = Groups.removeEphemeralGroups(_groupNames);

				if (groupNames.length === 0) {
					return callback(null, results);
				}

				async.map(groupNames, (groupName, next) => {
					Groups.isMembers(uids, groupName, next);
				}, next);
			},
			(isGroupMembers, next) => {
				isGroupMembers.forEach((isMembers) => {
					results.forEach((isMember, index) => {
						if (!isMember && isMembers[index]) {
							results[index] = true;
						}
					});
				});
				next(null, results);
			},
		], callback);
	};

	Groups.isInvited = (uid, groupName, callback) => {
		if (!uid) {
			return setImmediate(callback, null, false);
		}
		db.isSetMember('group:' + groupName + ':invited', uid, callback);
	};

	Groups.isPending = (uid, groupName, callback) => {
		if (!uid) {
			return setImmediate(callback, null, false);
		}
		db.isSetMember('group:' + groupName + ':pending', uid, callback);
	};

	Groups.getPending = (groupName, callback) => {
		if (!groupName) {
			return setImmediate(callback, null, []);
		}
		db.getSetMembers('group:' + groupName + ':pending', callback);
	};

	Groups.kick = (uid, groupName, isOwner, callback) => {
		if (isOwner) {
			// If the owners set only contains one member, error out!
			async.waterfall([
				(next) => {
					db.setCount('group:' + groupName + ':owners', next);
				},
				(numOwners, next) => {
					if (numOwners <= 1) {
						return next(new Error('[[error:group-needs-owner]]'));
					}
					Groups.leave(groupName, uid, next);
				},
			], callback);
		} else {
			Groups.leave(groupName, uid, callback);
		}
	};
};
