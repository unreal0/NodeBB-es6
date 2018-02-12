var async = require('async');

var db = require('./database');
var user = require('./user');
var Groups = require('./groups');
var plugins = require('./plugins');
var privileges = require('./privileges');

var Categories = module.exports;

require('./categories/data')(Categories);
require('./categories/create')(Categories);
require('./categories/delete')(Categories);
require('./categories/topics')(Categories);
require('./categories/unread')(Categories);
require('./categories/activeusers')(Categories);
require('./categories/recentreplies')(Categories);
require('./categories/update')(Categories);

Categories.exists = (cid, callback) => {
	db.isSortedSetMember('categories:cid', cid, callback);
};

Categories.getCategoryById = (data, callback) => {
	var category;
	async.waterfall([
		(next) => {
			Categories.getCategories([data.cid], data.uid, next);
		},
		(categories, next) => {
			if (!categories[0]) {
				return next(new Error('[[error:invalid-cid]]'));
			}
			category = categories[0];
			data.category = category;
			async.parallel({
				topics: (next) => {
					Categories.getCategoryTopics(data, next);
				},
				topicCount: (next) => {
					Categories.getTopicCount(data, next);
				},
				isIgnored: (next) => {
					Categories.isIgnored([data.cid], data.uid, next);
				},
			}, next);
		},
		(results, next) => {
			category.topics = results.topics.topics;
			category.nextStart = results.topics.nextStart;
			category.isIgnored = results.isIgnored[0];
			category.topic_count = results.topicCount;

			plugins.fireHook('filter:category.get', { category: category, uid: data.uid }, next);
		},
		(data, next) => {
			next(null, data.category);
		},
	], callback);
};

Categories.isIgnored = (cids, uid, callback) => {
	db.isSortedSetMembers('uid:' + uid + ':ignored:cids', cids, callback);
};

Categories.getPageCount = (cid, uid, callback) => {
	async.waterfall([
		(next) => {
			async.parallel({
				topicCount: async.apply(Categories.getCategoryField, cid, 'topic_count'),
				settings: async.apply(user.getSettings, uid),
			}, next);
		},
		(results, next) => {
			if (!parseInt(results.topicCount, 10)) {
				return next(null, 1);
			}

			next(null, Math.ceil(parseInt(results.topicCount, 10) / results.settings.topicsPerPage));
		},
	], callback);
};

Categories.getAllCategories = (uid, callback) => {
	async.waterfall([
		(next) => {
			db.getSortedSetRange('categories:cid', 0, -1, next);
		},
		(cids, next) => {
			Categories.getCategories(cids, uid, next);
		},
	], callback);
};

Categories.getCategoriesByPrivilege = (set, uid, privilege, callback) => {
	async.waterfall([
		(next) => {
			db.getSortedSetRange(set, 0, -1, next);
		},
		(cids, next) => {
			privileges.categories.filterCids(privilege, cids, uid, next);
		},
		(cids, next) => {
			Categories.getCategories(cids, uid, next);
		},
	], callback);
};

Categories.getModerators = (cid, callback) => {
	async.waterfall([
		(next) => {
			Groups.getMembers('cid:' + cid + ':privileges:moderate', 0, -1, next);
		},
		(uids, next) => {
			user.getUsersFields(uids, ['uid', 'username', 'userslug', 'picture'], next);
		},
	], callback);
};

Categories.getCategories = (cids, uid, callback) => {
	if (!Array.isArray(cids)) {
		return callback(new Error('[[error:invalid-cid]]'));
	}

	if (!cids.length) {
		return callback(null, []);
	}

	async.waterfall([
		(next) => {
			async.parallel({
				categories: (next) => {
					Categories.getCategoriesData(cids, next);
				},
				children: (next) => {
					Categories.getChildren(cids, uid, next);
				},
				parents: (next) => {
					Categories.getParents(cids, next);
				},
				tagWhitelist: (next) => {
					Categories.getTagWhitelist(cids, next);
				},
				hasRead: (next) => {
					Categories.hasReadCategories(cids, uid, next);
				},
			}, next);
		},
		(results, next) => {
			uid = parseInt(uid, 10);
			results.categories.forEach((category, i) => {
				if (category) {
					category.children = results.children[i];
					category.parent = results.parents[i] || undefined;
					category.tagWhitelist = results.tagWhitelist[i];
					category['unread-class'] = (parseInt(category.topic_count, 10) === 0 || (results.hasRead[i] && uid !== 0)) ? '' : 'unread';
					calculateTopicPostCount(category);
				}
			});

			next(null, results.categories);
		},
	], callback);
};

Categories.getTagWhitelist = (cids, callback) => {
	var keys = cids.map((cid) =>
		'cid:' + cid + ':tag:whitelist'
	);
	db.getSortedSetsMembers(keys, callback);
};

function calculateTopicPostCount(category) {
	if (!category) {
		return;
	}

	var postCount = parseInt(category.post_count, 10) || 0;
	var topicCount = parseInt(category.topic_count, 10) || 0;
	if (!Array.isArray(category.children) || !category.children.length) {
		category.totalPostCount = postCount;
		category.totalTopicCount = topicCount;
		return;
	}

	category.children.forEach((child) => {
		calculateTopicPostCount(child);
		postCount += parseInt(child.totalPostCount, 10) || 0;
		topicCount += parseInt(child.totalTopicCount, 10) || 0;
	});

	category.totalPostCount = postCount;
	category.totalTopicCount = topicCount;
}

Categories.getParents = (cids, callback) => {
	var categoriesData;
	var parentCids;
	async.waterfall([
		(next) => {
			Categories.getCategoriesFields(cids, ['parentCid'], next);
		},
		(_categoriesData, next) => {
			categoriesData = _categoriesData;

			parentCids = categoriesData.filter((category) => category && category.hasOwnProperty('parentCid') && parseInt(category.parentCid, 10)).map((category) => parseInt(category.parentCid, 10));

			if (!parentCids.length) {
				return callback(null, cids.map(() => null));
			}

			Categories.getCategoriesData(parentCids, next);
		},
		(parentData, next) => {
			parentData = categoriesData.map((category) => parentData[parentCids.indexOf(parseInt(category.parentCid, 10))]);
			next(null, parentData);
		},
	], callback);
};

Categories.getChildren = (cids, uid, callback) => {
	var categories = cids.map((cid) => ({ cid: cid }));

	async.each(categories, (category, next) => {
		getChildrenRecursive(category, uid, next);
	}, (err) => {
		callback(err, categories.map((c) => c && c.children));
	});
};

function getChildrenRecursive(category, uid, callback) {
	async.waterfall([
		(next) => {
			db.getSortedSetRange('cid:' + category.cid + ':children', 0, -1, next);
		},
		(children, next) => {
			privileges.categories.filterCids('find', children, uid, next);
		},
		(children, next) => {
			children = children.filter((cid) => parseInt(category.cid, 10) !== parseInt(cid, 10));
			if (!children.length) {
				category.children = [];
				return callback();
			}
			Categories.getCategoriesData(children, next);
		},
		(children, next) => {
			children = children.filter(Boolean);
			category.children = children;

			var cids = children.map((child) => child.cid);

			Categories.hasReadCategories(cids, uid, next);
		},
		(hasRead, next) => {
			hasRead.forEach((read, i) => {
				var child = category.children[i];
				child['unread-class'] = (parseInt(child.topic_count, 10) === 0 || (read && uid !== 0)) ? '' : 'unread';
			});

			next();
		},
		(next) => {
			async.each(category.children, (child, next) => {
				getChildrenRecursive(child, uid, next);
			}, next);
		},
	], callback);
}

Categories.flattenCategories = (allCategories, categoryData) => {
	categoryData.forEach((category) => {
		if (category) {
			if (!category.parent) {
				allCategories.push(category);
			}

			if (Array.isArray(category.children) && category.children.length) {
				Categories.flattenCategories(allCategories, category.children);
			}
		}
	});
};

/**
 * Recursively build tree
 *
 * @param categories {array} flat list of categories
 * @param parentCid {number} start from 0 to build full tree
 */
Categories.getTree = (categories, parentCid) => {
	var tree = [];
	var i = 0;
	var len = categories.length;
	var category;

	for (i; i < len; i += 1) {
		category = categories[i];
		if (!category.hasOwnProperty('parentCid') || category.parentCid === null) {
			category.parentCid = 0;
		}

		if (parseInt(category.parentCid, 10) === parseInt(parentCid, 10)) {
			tree.push(category);
			category.children = Categories.getTree(categories, category.cid);
		}
	}

	return tree;
};

Categories.buildForSelect = (uid, privilege, callback) => {
	async.waterfall([
		(next) => {
			Categories.getCategoriesByPrivilege('cid:0:children', uid, privilege, next);
		},
		(categories, next) => {
			Categories.buildForSelectCategories(categories, next);
		},
	], callback);
};

Categories.buildForSelectCategories = (categories, callback) => {
	function recursive(category, categoriesData, level, depth) {
		var bullet = level ? '&bull; ' : '';
		category.value = category.cid;
		category.level = level;
		category.text = level + bullet + category.name;
		category.depth = depth;
		categoriesData.push(category);

		category.children.forEach((child) => {
			recursive(child, categoriesData, '&nbsp;&nbsp;&nbsp;&nbsp;' + level, depth + 1);
		});
	}

	var categoriesData = [];

	categories = categories.filter((category) => category && !parseInt(category.parentCid, 10));

	categories.forEach((category) => {
		recursive(category, categoriesData, '', 0);
	});
	callback(null, categoriesData);
};

Categories.getIgnorers = (cid, start, stop, callback) => {
	db.getSortedSetRevRange('cid:' + cid + ':ignorers', start, stop, callback);
};

Categories.filterIgnoringUids = (cid, uids, callback) => {
	async.waterfall([
		(next) => {
			db.isSortedSetMembers('cid:' + cid + ':ignorers', uids, next);
		},
		(isIgnoring, next) => {
			var readingUids = uids.filter((uid, index) => uid && !isIgnoring[index]);
			next(null, readingUids);
		},
	], callback);
};
