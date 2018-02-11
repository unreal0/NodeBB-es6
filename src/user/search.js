var async = require('async');
var meta = require('../meta');
var plugins = require('../plugins');
var db = require('../database');

module.exports = (User) => {
	User.search = (data, callback) => {
		var query = data.query || '';
		var searchBy = data.searchBy || 'username';
		var page = data.page || 1;
		var uid = data.uid || 0;
		var paginate = data.hasOwnProperty('paginate') ? data.paginate : true;

		var startTime = process.hrtime();

		var searchResult = {};
		async.waterfall([
			(next) => {
				if (searchBy === 'ip') {
					searchByIP(query, next);
				} else if (searchBy === 'uid') {
					next(null, [query]);
				} else {
					var searchMethod = data.findUids || findUids;
					searchMethod(query, searchBy, data.hardCap, next);
				}
			},
			(uids, next) => {
				filterAndSortUids(uids, data, next);
			},
			(uids, next) => {
				plugins.fireHook('filter:users.search', { uids: uids, uid: uid }, next);
			},
			(data, next) => {
				var uids = data.uids;
				searchResult.matchCount = uids.length;

				if (paginate) {
					var resultsPerPage = parseInt(meta.config.userSearchResultsPerPage, 10) || 20;
					var start = Math.max(0, page - 1) * resultsPerPage;
					var stop = start + resultsPerPage;
					searchResult.pageCount = Math.ceil(uids.length / resultsPerPage);
					uids = uids.slice(start, stop);
				}

				User.getUsers(uids, uid, next);
			},
			(userData, next) => {
				searchResult.timing = (process.elapsedTimeSince(startTime) / 1000).toFixed(2);
				searchResult.users = userData;
				next(null, searchResult);
			},
		], callback);
	};

	function findUids(query, searchBy, hardCap, callback) {
		if (!query) {
			return callback(null, []);
		}
		query = query.toLowerCase();
		var min = query;
		var max = query.substr(0, query.length - 1) + String.fromCharCode(query.charCodeAt(query.length - 1) + 1);

		var resultsPerPage = parseInt(meta.config.userSearchResultsPerPage, 10) || 20;
		hardCap = hardCap || resultsPerPage * 10;

		async.waterfall([
			(next) => {
				db.getSortedSetRangeByLex(searchBy + ':sorted', min, max, 0, hardCap, next);
			},
			(data, next) => {
				var uids = data.map(data => (
					data.split(':')[1]
				));
				next(null, uids);
			},
		], callback);
	}

	function filterAndSortUids(uids, data, callback) {
		uids = uids.filter(uid => parseInt(uid, 10));

		var fields = [];

		if (data.sortBy) {
			fields.push(data.sortBy);
		}
		if (data.onlineOnly) {
			fields = fields.concat(['status', 'lastonline']);
		}
		if (data.bannedOnly) {
			fields.push('banned');
		}
		if (data.flaggedOnly) {
			fields.push('flags');
		}

		if (!fields.length) {
			return callback(null, uids);
		}

		fields = ['uid'].concat(fields);

		async.waterfall([
			(next) => {
				User.getUsersFields(uids, fields, next);
			},
			(userData, next) => {
				if (data.onlineOnly) {
					userData = userData.filter(user => user && user.status !== 'offline' && (Date.now() - parseInt(user.lastonline, 10) < 300000));
				}

				if (data.bannedOnly) {
					userData = userData.filter(user => user && parseInt(user.banned, 10) === 1);
				}

				if (data.flaggedOnly) {
					userData = userData.filter(user => user && parseInt(user.flags, 10) > 0);
				}

				if (data.sortBy) {
					sortUsers(userData, data.sortBy);
				}

				uids = userData.map(user => user && user.uid);

				next(null, uids);
			},
		], callback);
	}

	function sortUsers(userData, sortBy) {
		if (sortBy === 'joindate' || sortBy === 'postcount' || sortBy === 'reputation') {
			userData.sort((u1, u2) => u2[sortBy] - u1[sortBy]);
		} else {
			userData.sort((u1, u2) => {
				if (u1[sortBy] < u2[sortBy]) {
					return -1;
				} else if (u1[sortBy] > u2[sortBy]) {
					return 1;
				}
				return 0;
			});
		}
	}

	function searchByIP(ip, callback) {
		db.getSortedSetRevRange('ip:' + ip + ':uid', 0, -1, callback);
	}
};
