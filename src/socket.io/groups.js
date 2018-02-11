var async = require('async');

var groups = require('../groups');
var meta = require('../meta');
var user = require('../user');
var utils = require('../utils');
var groupsController = require('../controllers/groups');
var events = require('../events');

var SocketGroups = module.exports;

SocketGroups.before = (socket, method, data, next) => {
	if (!data) {
		return next(new Error('[[error:invalid-data]]'));
	}
	next();
};

SocketGroups.join = (socket, data, callback) => {
	if (!parseInt(socket.uid, 10)) {
		return callback(new Error('[[error:invalid-uid]]'));
	}

	if (data.groupName === 'administrators' || groups.isPrivilegeGroup(data.groupName)) {
		return callback(new Error('[[error:not-allowed]]'));
	}

	async.waterfall([
		(next) => {
			groups.exists(data.groupName, next);
		},
		(exists, next) => {
			if (!exists) {
				return next(new Error('[[error:no-group]]'));
			}

			if (parseInt(meta.config.allowPrivateGroups, 10) !== 1) {
				return groups.join(data.groupName, socket.uid, callback);
			}

			async.parallel({
				isAdmin: async.apply(user.isAdministrator, socket.uid),
				groupData: async.apply(groups.getGroupData, data.groupName),
			}, next);
		},
		(results, next) => {
			if (results.groupData.private && results.groupData.disableJoinRequests) {
				return next(new Error('[[error:join-requests-disabled]]'));
			}

			if (!results.groupData.private || results.isAdmin) {
				groups.join(data.groupName, socket.uid, next);
			} else {
				groups.requestMembership(data.groupName, socket.uid, next);
			}
		},
	], callback);
};

SocketGroups.leave = (socket, data, callback) => {
	if (!parseInt(socket.uid, 10)) {
		return callback(new Error('[[error:invalid-uid]]'));
	}

	if (data.groupName === 'administrators') {
		return callback(new Error('[[error:cant-remove-self-as-admin]]'));
	}

	groups.leave(data.groupName, socket.uid, callback);
};

function isOwner(next) {
	return (socket, data, callback) => {
		async.parallel({
			isAdmin: async.apply(user.isAdministrator, socket.uid),
			isOwner: async.apply(groups.ownership.isOwner, socket.uid, data.groupName),
		}, (err, results) => {
			if (err || (!results.isOwner && !results.isAdmin)) {
				return callback(err || new Error('[[error:no-privileges]]'));
			}
			next(socket, data, callback);
		});
	};
}

function isInvited(next) {
	return (socket, data, callback) => {
		groups.isInvited(socket.uid, data.groupName, (err, invited) => {
			if (err || !invited) {
				return callback(err || new Error('[[error:not-invited]]'));
			}
			next(socket, data, callback);
		});
	};
}

SocketGroups.grant = isOwner((socket, data, callback) => {
	groups.ownership.grant(data.toUid, data.groupName, callback);
});

SocketGroups.rescind = isOwner((socket, data, callback) => {
	groups.ownership.rescind(data.toUid, data.groupName, callback);
});

SocketGroups.accept = isOwner((socket, data, callback) => {
	async.waterfall([
		(next) => {
			groups.acceptMembership(data.groupName, data.toUid, next);
		},
		(next) => {
			events.log({
				type: 'accept-membership',
				uid: socket.uid,
				ip: socket.ip,
				groupName: data.groupName,
				targetUid: data.toUid,
			});
			setImmediate(next);
		},
	], callback);
});

SocketGroups.reject = isOwner((socket, data, callback) => {
	async.waterfall([
		(next) => {
			groups.rejectMembership(data.groupName, data.toUid, next);
		},
		(next) => {
			events.log({
				type: 'reject-membership',
				uid: socket.uid,
				ip: socket.ip,
				groupName: data.groupName,
				targetUid: data.toUid,
			});
			setImmediate(next);
		},
	], callback);
});

SocketGroups.acceptAll = isOwner((socket, data, callback) => {
	acceptRejectAll(SocketGroups.accept, socket, data, callback);
});

SocketGroups.rejectAll = isOwner((socket, data, callback) => {
	acceptRejectAll(SocketGroups.reject, socket, data, callback);
});

function acceptRejectAll(method, socket, data, callback) {
	async.waterfall([
		(next) => {
			groups.getPending(data.groupName, next);
		},
		(uids, next) => {
			async.each(uids, (uid, next) => {
				method(socket, { groupName: data.groupName, toUid: uid }, next);
			}, next);
		},
	], callback);
}

SocketGroups.issueInvite = isOwner((socket, data, callback) => {
	groups.invite(data.groupName, data.toUid, callback);
});

SocketGroups.issueMassInvite = isOwner((socket, data, callback) => {
	if (!data || !data.usernames || !data.groupName) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	var usernames = String(data.usernames).split(',');
	usernames = usernames.map(username => username && username.trim());

	async.waterfall([
		(next) => {
			user.getUidsByUsernames(usernames, next);
		},
		(uids, next) => {
			uids = uids.filter(uid => !!uid && parseInt(uid, 10));

			async.eachSeries(uids, (uid, next) => {
				groups.invite(data.groupName, uid, next);
			}, next);
		},
	], callback);
});

SocketGroups.rescindInvite = isOwner((socket, data, callback) => {
	groups.rejectMembership(data.groupName, data.toUid, callback);
});

SocketGroups.acceptInvite = isInvited((socket, data, callback) => {
	groups.acceptMembership(data.groupName, socket.uid, callback);
});

SocketGroups.rejectInvite = isInvited((socket, data, callback) => {
	groups.rejectMembership(data.groupName, socket.uid, callback);
});

SocketGroups.update = isOwner((socket, data, callback) => {
	groups.update(data.groupName, data.values, callback);
});


SocketGroups.kick = isOwner((socket, data, callback) => {
	if (socket.uid === parseInt(data.uid, 10)) {
		return callback(new Error('[[error:cant-kick-self]]'));
	}

	async.waterfall([
		(next) => {
			groups.ownership.isOwner(data.uid, data.groupName, next);
		},
		(isOwner, next) => {
			groups.kick(data.uid, data.groupName, isOwner, next);
		},
	], callback);
});

SocketGroups.create = (socket, data, callback) => {
	if (!socket.uid) {
		return callback(new Error('[[error:no-privileges]]'));
	} else if (parseInt(meta.config.allowGroupCreation, 10) !== 1) {
		return callback(new Error('[[error:group-creation-disabled]]'));
	} else if (groups.isPrivilegeGroup(data.name)) {
		return callback(new Error('[[error:invalid-group-name]]'));
	}

	data.ownerUid = socket.uid;
	groups.create(data, callback);
};

SocketGroups.delete = isOwner((socket, data, callback) => {
	if (data.groupName === 'administrators' ||
		data.groupName === 'registered-users' ||
		data.groupName === 'Global Moderators') {
		return callback(new Error('[[error:not-allowed]]'));
	}

	groups.destroy(data.groupName, callback);
});

SocketGroups.search = (socket, data, callback) => {
	data.options = data.options || {};

	if (!data.query) {
		var groupsPerPage = 15;
		groupsController.getGroupsFromSet(socket.uid, data.options.sort, 0, groupsPerPage - 1, (err, data) => {
			callback(err, !err ? data.groups : null);
		});
		return;
	}

	groups.search(data.query, data.options, callback);
};

SocketGroups.loadMore = (socket, data, callback) => {
	if (!data.sort || !utils.isNumber(data.after) || parseInt(data.after, 10) < 0) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	var groupsPerPage = 9;
	var start = parseInt(data.after, 10);
	var stop = start + groupsPerPage - 1;
	groupsController.getGroupsFromSet(socket.uid, data.sort, start, stop, callback);
};

SocketGroups.searchMembers = (socket, data, callback) => {
	data.uid = socket.uid;
	groups.searchMembers(data, callback);
};

SocketGroups.loadMoreMembers = (socket, data, callback) => {
	if (!data.groupName || !utils.isNumber(data.after) || parseInt(data.after, 10) < 0) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	data.after = parseInt(data.after, 10);
	async.waterfall([
		(next) => {
			user.getUsersFromSet('group:' + data.groupName + ':members', socket.uid, data.after, data.after + 9, next);
		},
		(users, next) => {
			next(null, {
				users: users,
				nextStart: data.after + 10,
			});
		},
	], callback);
};

SocketGroups.cover = {};

SocketGroups.cover.update = (socket, data, callback) => {
	if (!socket.uid) {
		return callback(new Error('[[error:no-privileges]]'));
	}

	async.waterfall([
		(next) => {
			groups.ownership.isOwner(socket.uid, data.groupName, next);
		},
		(isOwner, next) => {
			if (!isOwner) {
				return next(new Error('[[error:no-privileges]]'));
			}

			groups.updateCover(socket.uid, data, next);
		},
	], callback);
};

SocketGroups.cover.remove = (socket, data, callback) => {
	if (!socket.uid) {
		return callback(new Error('[[error:no-privileges]]'));
	}

	async.waterfall([
		(next) => {
			groups.ownership.isOwner(socket.uid, data.groupName, next);
		},
		(isOwner, next) => {
			if (!isOwner) {
				return next(new Error('[[error:no-privileges]]'));
			}

			groups.removeCover(data, next);
		},
	], callback);
};
