var async = require('async');
var _ = require('lodash');

var db = require('./database');
var posts = require('./posts');
var topics = require('./topics');
var categories = require('./categories');
var user = require('./user');
var plugins = require('./plugins');
var privileges = require('./privileges');
var utils = require('./utils');

var search = module.exports;

search.search = (data, callback) => {
	var start = process.hrtime();
	var searchIn = data.searchIn || 'titlesposts';

	async.waterfall([
		(next) => {
			if (searchIn === 'posts' || searchIn === 'titles' || searchIn === 'titlesposts') {
				searchInContent(data, next);
			} else if (searchIn === 'users') {
				user.search(data, next);
			} else if (searchIn === 'tags') {
				topics.searchAndLoadTags(data, next);
			} else {
				next(new Error('[[error:unknown-search-filter]]'));
			}
		},
		(result, next) => {
			result.time = (process.elapsedTimeSince(start) / 1000).toFixed(2);
			next(null, result);
		},
	], callback);
};

function searchInContent(data, callback) {
	data.uid = data.uid || 0;
	var matchCount = 0;
	var pids;
	var metadata;

	async.waterfall([
		(next) => {
			async.parallel({
				searchCids: (next) => {
					getSearchCids(data, next);
				},
				searchUids: (next) => {
					getSearchUids(data, next);
				},
			}, next);
		},
		(results, next) => {
			function doSearch(type, searchIn, next) {
				if (searchIn.indexOf(data.searchIn) !== -1) {
					search.searchQuery(type, data.query, results.searchCids, results.searchUids, next);
				} else {
					next(null, []);
				}
			}
			async.parallel({
				pids: (next) => {
					doSearch('post', ['posts', 'titlesposts'], next);
				},
				tids: (next) => {
					doSearch('topic', ['titles', 'titlesposts'], next);
				},
			}, next);
		},
		(results, next) => {
			pids = results.pids;
			if (!results || (!results.pids.length && !results.tids.length)) {
				return callback(null, { posts: [], matchCount: matchCount, pageCount: 1 });
			}

			topics.getMainPids(results.tids, next);
		},
		(mainPids, next) => {
			pids = mainPids.concat(pids).map(pid => pid && pid.toString()).filter(Boolean);

			privileges.posts.filter('read', pids, data.uid, next);
		},
		(pids, next) => {
			filterAndSort(pids, data, next);
		},
		(pids, next) => {
			plugins.fireHook('filter:search.inContent', {
				pids: pids,
			}, next);
		},
		(_metadata, next) => {
			metadata = _metadata;
			matchCount = metadata.pids.length;

			if (data.page) {
				var start = Math.max(0, (data.page - 1)) * 10;
				metadata.pids = metadata.pids.slice(start, start + 10);
			}

			posts.getPostSummaryByPids(metadata.pids, data.uid, {}, next);
		},
		(posts, next) => {
			// Append metadata to returned payload (without pids)
			delete metadata.pids;
			next(null, Object.assign({ posts: posts, matchCount: matchCount, pageCount: Math.max(1, Math.ceil(parseInt(matchCount, 10) / 10)) }, metadata));
		},
	], callback);
}

function filterAndSort(pids, data, callback) {
	async.waterfall([
		(next) => {
			getMatchedPosts(pids, data, next);
		},
		(posts, next) => {
			if (!posts.length) {
				return callback(null, pids);
			}
			posts = posts.filter(Boolean);

			posts = filterByPostcount(posts, data.replies, data.repliesFilter);
			posts = filterByTimerange(posts, data.timeRange, data.timeFilter);
			posts = filterByTags(posts, data.hasTags);

			sortPosts(posts, data);

			plugins.fireHook('filter:search.filterAndSort', { pids: pids, posts: posts, data: data }, next);
		},
		(result, next) => {
			pids = result.posts.map(post => post && post.pid);

			next(null, pids);
		},
	], callback);
}

function getMatchedPosts(pids, data, callback) {
	var postFields = ['pid', 'uid', 'tid', 'timestamp', 'deleted'];
	var categoryFields = [];

	if (data.sortBy && data.sortBy !== 'relevance') {
		if (data.sortBy.startsWith('category.')) {
			categoryFields.push(data.sortBy.split('.')[1]);
		}
	}

	var posts;
	async.waterfall([
		(next) => {
			var keys = pids.map(pid => 'post:' + pid);
			db.getObjectsFields(keys, postFields, next);
		},
		(_posts, next) => {
			posts = _posts.filter(post => post && parseInt(post.deleted, 10) !== 1);

			async.parallel({
				users: (next) => {
					if (data.sortBy && data.sortBy.startsWith('user')) {
						var uids = posts.map(post => post.uid);
						user.getUsersFields(uids, ['username'], next);
					} else {
						next();
					}
				},
				topics: (next) => {
					var topicsData;
					async.waterfall([
						(next) => {
							var topicKeys = posts.map(post => 'topic:' + post.tid);
							db.getObjects(topicKeys, next);
						},
						(_topics, next) => {
							topicsData = _topics;

							async.parallel({
								teasers: (next) => {
									if (data.sortBy && data.sortBy.startsWith('teaser')) {
										var teaserKeys = topicsData.map(topic => 'post:' + topic.teaserPid);
										db.getObjectsFields(teaserKeys, ['timestamp'], next);
									} else {
										next();
									}
								},
								categories: (next) => {
									if (!categoryFields.length) {
										return next();
									}
									var cids = topicsData.map(topic => 'category:' + topic.cid);
									db.getObjectsFields(cids, categoryFields, next);
								},
								tags: (next) => {
									if (Array.isArray(data.hasTags) && data.hasTags.length) {
										var tids = posts.map(post => post && post.tid);
										topics.getTopicsTags(tids, next);
									} else {
										setImmediate(next);
									}
								},
							}, next);
						},
						(results, next) => {
							topicsData.forEach((topic, index) => {
								if (topic && results.categories && results.categories[index]) {
									topic.category = results.categories[index];
								}
								if (topic && results.teasers && results.teasers[index]) {
									topic.teaser = results.teasers[index];
								}
								if (topic && results.tags && results.tags[index]) {
									topic.tags = results.tags[index];
								}
							});

							next(null, topicsData);
						},
					], next);
				},
			}, next);
		},
		(results, next) => {
			posts.forEach((post, index) => {
				if (results.topics && results.topics[index]) {
					post.topic = results.topics[index];
					if (results.topics[index].category) {
						post.category = results.topics[index].category;
					}
					if (results.topics[index].teaser) {
						post.teaser = results.topics[index].teaser;
					}
				}

				if (results.users && results.users[index]) {
					post.user = results.users[index];
				}
			});

			posts = posts.filter(post => post && post.topic && parseInt(post.topic.deleted, 10) !== 1);

			next(null, posts);
		},
	], callback);
}

function filterByPostcount(posts, postCount, repliesFilter) {
	postCount = parseInt(postCount, 10);
	if (postCount) {
		if (repliesFilter === 'atleast') {
			posts = posts.filter(post => post.topic && post.topic.postcount >= postCount);
		} else {
			posts = posts.filter(post => post.topic && post.topic.postcount <= postCount);
		}
	}
	return posts;
}

function filterByTimerange(posts, timeRange, timeFilter) {
	timeRange = parseInt(timeRange, 10) * 1000;
	if (timeRange) {
		var time = Date.now() - timeRange;
		if (timeFilter === 'newer') {
			posts = posts.filter(post => post.timestamp >= time);
		} else {
			posts = posts.filter(post => post.timestamp <= time);
		}
	}
	return posts;
}

function filterByTags(posts, hasTags) {
	if (Array.isArray(hasTags) && hasTags.length) {
		posts = posts.filter((post) => {
			var hasAllTags = false;
			if (post && post.topic && Array.isArray(post.topic.tags) && post.topic.tags.length) {
				hasAllTags = hasTags.every(tag => post.topic.tags.indexOf(tag) !== -1);
			}
			return hasAllTags;
		});
	}
	return posts;
}

function sortPosts(posts, data) {
	if (!posts.length || !data.sortBy || data.sortBy === 'relevance') {
		return;
	}

	data.sortDirection = data.sortDirection || 'desc';
	var direction = data.sortDirection === 'desc' ? 1 : -1;

	if (data.sortBy === 'timestamp') {
		posts.sort((p1, p2) => direction * (p2.timestamp - p1.timestamp));

		return;
	}

	var firstPost = posts[0];
	var fields = data.sortBy.split('.');

	if (!fields || fields.length !== 2 || !firstPost[fields[0]] || !firstPost[fields[0]][fields[1]]) {
		return;
	}

	var isNumeric = utils.isNumber(firstPost[fields[0]][fields[1]]);

	if (isNumeric) {
		posts.sort((p1, p2) => direction * (p2[fields[0]][fields[1]] - p1[fields[0]][fields[1]]));
	} else {
		posts.sort((p1, p2) => {
			if (p1[fields[0]][fields[1]] > p2[fields[0]][fields[1]]) {
				return direction;
			} else if (p1[fields[0]][fields[1]] < p2[fields[0]][fields[1]]) {
				return -direction;
			}
			return 0;
		});
	}
}

function getSearchCids(data, callback) {
	if (!Array.isArray(data.categories) || !data.categories.length) {
		return callback(null, []);
	}

	if (data.categories.indexOf('all') !== -1) {
		async.waterfall([
			(next) => {
				db.getSortedSetRange('categories:cid', 0, -1, next);
			},
			(cids, next) => {
				privileges.categories.filterCids('read', cids, data.uid, next);
			},
		], callback);
		return;
	}

	async.waterfall([
		(next) => {
			async.parallel({
				watchedCids: (next) => {
					if (data.categories.indexOf('watched') !== -1) {
						user.getWatchedCategories(data.uid, next);
					} else {
						next(null, []);
					}
				},
				childrenCids: (next) => {
					if (data.searchChildren) {
						getChildrenCids(data.categories, data.uid, next);
					} else {
						next(null, []);
					}
				},
			}, next);
		},
		(results, next) => {
			var cids = results.watchedCids.concat(results.childrenCids).concat(data.categories).filter(Boolean);
			cids = _.uniq(cids);
			next(null, cids);
		},
	], callback);
}

function getChildrenCids(cids, uid, callback) {
	async.waterfall([
		(next) => {
			categories.getChildren(cids, uid, next);
		},
		(childrenCategories, next) => {
			var childrenCids = [];
			var allCategories = [];

			childrenCategories.forEach((childrens) => {
				categories.flattenCategories(allCategories, childrens);
				childrenCids = childrenCids.concat(allCategories.map(category => category && category.cid));
			});

			next(null, childrenCids);
		},
	], callback);
}

function getSearchUids(data, callback) {
	if (data.postedBy) {
		user.getUidsByUsernames(Array.isArray(data.postedBy) ? data.postedBy : [data.postedBy], callback);
	} else {
		callback(null, []);
	}
}

search.searchQuery = (index, content, cids, uids, callback) => {
	plugins.fireHook('filter:search.query', {
		index: index,
		content: content,
		cid: cids,
		uid: uids,
	}, callback);
};

