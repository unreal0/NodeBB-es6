var async = require('async');

var user = require('../user');
var db = require('./../database');


module.exports = (Groups) => {
	Groups.search = (query, options, callback) => {
		if (!query) {
			return callback(null, []);
		}
		query = query.toLowerCase();
		async.waterfall([
			async.apply(db.getObjectValues, 'groupslug:groupname'),
			(groupNames, next) => {
				// Ephemeral groups and the registered-users groups are searchable
				groupNames = Groups.ephemeralGroups.concat(groupNames).concat('registered-users');
				groupNames = groupNames.filter(name => name.toLowerCase().indexOf(query) !== -1 && name !== 'administrators' && !Groups.isPrivilegeGroup(name));
				groupNames = groupNames.slice(0, 100);
				Groups.getGroupsData(groupNames, next);
			},
			(groupsData, next) => {
				groupsData = groupsData.filter(Boolean);
				if (options.filterHidden) {
					groupsData = groupsData.filter(group => !group.hidden);
				}

				Groups.sort(options.sort, groupsData, next);
			},
		], callback);
	};

	Groups.sort = (strategy, groups, next) => {
		switch (strategy) {
		case 'count':
			groups = groups.sort((a, b) => a.slug > b.slug).sort((a, b) => b.memberCount - a.memberCount);
			break;

		case 'date':
			groups = groups.sort((a, b) => b.createtime - a.createtime);
			break;

		case 'alpha':	// intentional fall-through
		default:
			groups = groups.sort((a, b) => (a.slug > b.slug ? 1 : -1));
		}

		next(null, groups);
	};

	Groups.searchMembers = (data, callback) => {
		if (!data.query) {
			Groups.getOwnersAndMembers(data.groupName, data.uid, 0, 19, (err, users) => {
				callback(err, { users: users });
			});
			return;
		}

		var results;
		async.waterfall([
			(next) => {
				data.paginate = false;
				user.search(data, next);
			},
			(_results, next) => {
				results = _results;
				var uids = results.users.map(user => user && user.uid);

				Groups.isMembers(uids, data.groupName, next);
			},
			(isMembers, next) => {
				results.users = results.users.filter((user, index) => isMembers[index]);
				var uids = results.users.map(user => user && user.uid);
				Groups.ownership.isOwners(uids, data.groupName, next);
			},
			(isOwners, next) => {
				results.users.forEach((user, index) => {
					if (user) {
						user.isOwner = isOwners[index];
					}
				});

				results.users.sort((a, b) => {
					if (a.isOwner && !b.isOwner) {
						return -1;
					} else if (!a.isOwner && b.isOwner) {
						return 1;
					}
					return 0;
				});
				next(null, results);
			},
		], callback);
	};
};
