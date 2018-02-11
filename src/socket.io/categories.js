var async = require('async');
var db = require('../database');
var categories = require('../categories');
var privileges = require('../privileges');
var user = require('../user');
var topics = require('../topics');
var apiController = require('../controllers/api');

var SocketCategories = module.exports;

SocketCategories.getRecentReplies = (socket, cid, callback) => {
	categories.getRecentReplies(cid, socket.uid, 4, callback);
};

SocketCategories.get = (socket, data, callback) => {
	async.waterfall([
		(next) => {
			async.parallel({
				isAdmin: async.apply(user.isAdministrator, socket.uid),
				categories: (next) => {
					async.waterfall([
						async.apply(db.getSortedSetRange, 'categories:cid', 0, -1),
						async.apply(categories.getCategoriesData),
					], next);
				},
			}, next);
		},
		(results, next) => {
			results.categories = results.categories.filter(category => category && (!category.disabled || results.isAdmin));

			next(null, results.categories);
		},
	], callback);
};

SocketCategories.getWatchedCategories = (socket, data, callback) => {
	async.waterfall([
		(next) => {
			async.parallel({
				categories: async.apply(categories.getCategoriesByPrivilege, 'cid:0:children', socket.uid, 'find'),
				ignoredCids: async.apply(user.getIgnoredCategories, socket.uid),
			}, next);
		},
		(results, next) => {
			var watchedCategories = results.categories.filter(category => category && results.ignoredCids.indexOf(category.cid.toString()) === -1);

			next(null, watchedCategories);
		},
	], callback);
};

SocketCategories.loadMore = (socket, data, callback) => {
	if (!data) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	data.query = data.query || {};
	var userPrivileges;
	async.waterfall([
		(next) => {
			async.parallel({
				privileges: (next) => {
					privileges.categories.get(data.cid, socket.uid, next);
				},
				settings: (next) => {
					user.getSettings(socket.uid, next);
				},
				targetUid: (next) => {
					if (data.query.author) {
						user.getUidByUserslug(data.query.author, next);
					} else {
						next();
					}
				},
			}, next);
		},
		(results, next) => {
			userPrivileges = results.privileges;
			if (!userPrivileges.read) {
				return callback(new Error('[[error:no-privileges]]'));
			}
			var infScrollTopicsPerPage = 20;
			var sort = data.sort || data.categoryTopicSort;

			var start = Math.max(0, parseInt(data.after, 10));

			if (data.direction === -1) {
				start -= infScrollTopicsPerPage;
			}

			var stop = start + infScrollTopicsPerPage - 1;

			start = Math.max(0, start);
			stop = Math.max(0, stop);
			categories.getCategoryTopics({
				uid: socket.uid,
				cid: data.cid,
				start: start,
				stop: stop,
				sort: sort,
				settings: results.settings,
				query: data.query,
				tag: data.query.tag,
				targetUid: results.targetUid,
			}, next);
		},
		(data, next) => {
			categories.modifyTopicsByPrivilege(data.topics, userPrivileges);

			data.privileges = userPrivileges;
			data.template = {
				category: true,
				name: 'category',
			};

			next(null, data);
		},
	], callback);
};

SocketCategories.getPageCount = (socket, cid, callback) => {
	categories.getPageCount(cid, socket.uid, callback);
};

SocketCategories.getTopicCount = (socket, cid, callback) => {
	categories.getCategoryField(cid, 'topic_count', callback);
};

SocketCategories.getCategoriesByPrivilege = (socket, privilege, callback) => {
	categories.getCategoriesByPrivilege('categories:cid', socket.uid, privilege, callback);
};

SocketCategories.getMoveCategories = (socket, data, callback) => {
	async.waterfall([
		(next) => {
			async.parallel({
				isAdmin: async.apply(user.isAdministrator, socket.uid),
				categories: (next) => {
					async.waterfall([
						(next) => {
							db.getSortedSetRange('cid:0:children', 0, -1, next);
						},
						(cids, next) => {
							categories.getCategories(cids, socket.uid, next);
						},
						(categoriesData, next) => {
							categories.buildForSelectCategories(categoriesData, next);
						},
					], next);
				},
			}, next);
		},
		(results, next) => {
			results.categories = results.categories.filter(category => category && (!category.disabled || results.isAdmin) && !category.link);

			next(null, results.categories);
		},
	], callback);
};

SocketCategories.watch = (socket, cid, callback) => {
	ignoreOrWatch(user.watchCategory, socket, cid, callback);
};

SocketCategories.ignore = (socket, cid, callback) => {
	ignoreOrWatch(user.ignoreCategory, socket, cid, callback);
};

function ignoreOrWatch(fn, socket, cid, callback) {
	async.waterfall([
		(next) => {
			db.getSortedSetRange('categories:cid', 0, -1, next);
		},
		(cids, next) => {
			categories.getCategoriesFields(cids, ['cid', 'parentCid'], next);
		},
		(categoryData, next) => {
			categoryData.forEach((c) => {
				c.cid = parseInt(c.cid, 10);
				c.parentCid = parseInt(c.parentCid, 10);
			});

			var cids = [parseInt(cid, 10)];

			// filter to subcategories of cid

			var cat;
			do {
				cat = categoryData.find(c => cids.indexOf(c.cid) === -1 && cids.indexOf(c.parentCid) !== -1);
				if (cat) {
					cids.push(cat.cid);
				}
			} while (cat);

			async.each(cids, (cid, next) => {
				fn(socket.uid, cid, next);
			}, next);
		},
		(next) => {
			topics.pushUnreadCount(socket.uid, next);
		},
	], callback);
}

SocketCategories.isModerator = (socket, cid, callback) => {
	user.isModerator(socket.uid, cid, callback);
};

SocketCategories.getCategory = (socket, cid, callback) => {
	apiController.getCategoryData(cid, socket.uid, callback);
};
