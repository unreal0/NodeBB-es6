var async = require('async');
var groups = require('../../groups');

var Groups = module.exports;

Groups.create = (socket, data, callback) => {
	if (!data) {
		return callback(new Error('[[error:invalid-data]]'));
	} else if (groups.isPrivilegeGroup(data.name)) {
		return callback(new Error('[[error:invalid-group-name]]'));
	}

	groups.create({
		name: data.name,
		description: data.description,
		ownerUid: socket.uid,
	}, callback);
};

Groups.join = (socket, data, callback) => {
	if (!data) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	async.waterfall([
		(next) => {
			groups.isMember(data.uid, data.groupName, next);
		},
		(isMember, next) => {
			if (isMember) {
				return next(new Error('[[error:group-already-member]]'));
			}
			groups.join(data.groupName, data.uid, next);
		},
	], callback);
};

Groups.leave = (socket, data, callback) => {
	if (!data) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	if (socket.uid === parseInt(data.uid, 10) && data.groupName === 'administrators') {
		return callback(new Error('[[error:cant-remove-self-as-admin]]'));
	}

	async.waterfall([
		(next) => {
			groups.isMember(data.uid, data.groupName, next);
		},
		(isMember, next) => {
			if (!isMember) {
				return next(new Error('[[error:group-not-member]]'));
			}
			groups.leave(data.groupName, data.uid, next);
		},
	], callback);
};

Groups.update = (socket, data, callback) => {
	if (!data) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	groups.update(data.groupName, data.values, callback);
};
