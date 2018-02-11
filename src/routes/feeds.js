var async = require('async');
var rss = require('rss');
var nconf = require('nconf');
var validator = require('validator');

var posts = require('../posts');
var topics = require('../topics');
var user = require('../user');
var categories = require('../categories');
var meta = require('../meta');
var helpers = require('../controllers/helpers');
var privileges = require('../privileges');
var db = require('../database');
var controllers404 = require('../controllers/404.js');

module.exports = (app, middleware) => {
	app.get('/topic/:topic_id.rss', middleware.maintenanceMode, generateForTopic);
	app.get('/category/:category_id.rss', middleware.maintenanceMode, generateForCategory);
	app.get('/recent.rss', middleware.maintenanceMode, generateForRecent);
	app.get('/top.rss', middleware.maintenanceMode, generateForTop);
	app.get('/popular.rss', middleware.maintenanceMode, generateForPopular);
	app.get('/popular/:term.rss', middleware.maintenanceMode, generateForPopular);
	app.get('/recentposts.rss', middleware.maintenanceMode, generateForRecentPosts);
	app.get('/category/:category_id/recentposts.rss', middleware.maintenanceMode, generateForCategoryRecentPosts);
	app.get('/user/:userslug/topics.rss', middleware.maintenanceMode, generateForUserTopics);
	app.get('/tags/:tag.rss', middleware.maintenanceMode, generateForTag);
};

function validateTokenIfRequiresLogin(requiresLogin, cid, req, res, callback) {
	var uid = req.query.uid;
	var token = req.query.token;

	if (!requiresLogin) {
		return callback();
	}

	if (!uid || !token) {
		return helpers.notAllowed(req, res);
	}

	async.waterfall([
		(next) => {
			db.getObjectField('user:' + uid, 'rss_token', next);
		},
		(_token, next) => {
			if (token === _token) {
				async.waterfall([
					(next) => {
						privileges.categories.get(cid, uid, next);
					},
					(privileges, next) => {
						if (!privileges.read) {
							return helpers.notAllowed(req, res);
						}
						next();
					},
				], callback);
				return;
			}
			user.auth.logAttempt(uid, req.ip, next);
		},
		() => {
			helpers.notAllowed(req, res);
		},
	], callback);
}

function generateForTopic(req, res, callback) {
	if (parseInt(meta.config['feeds:disableRSS'], 10) === 1) {
		return controllers404.send404(req, res);
	}

	var tid = req.params.topic_id;
	var userPrivileges;
	var topic;
	async.waterfall([
		(next) => {
			async.parallel({
				privileges: (next) => {
					privileges.topics.get(tid, req.uid, next);
				},
				topic: (next) => {
					topics.getTopicData(tid, next);
				},
			}, next);
		},
		(results, next) => {
			if (!results.topic || (parseInt(results.topic.deleted, 10) && !results.privileges.view_deleted)) {
				return controllers404.send404(req, res);
			}
			userPrivileges = results.privileges;
			topic = results.topic;
			validateTokenIfRequiresLogin(!results.privileges['topics:read'], results.topic.cid, req, res, next);
		},
		(next) => {
			topics.getTopicWithPosts(topic, 'tid:' + tid + ':posts', req.uid || req.query.uid || 0, 0, 25, false, next);
		},
		(topicData) => {
			topics.modifyPostsByPrivilege(topicData, userPrivileges);

			var description = topicData.posts.length ? topicData.posts[0].content : '';
			var image_url = topicData.posts.length ? topicData.posts[0].picture : '';
			var author = topicData.posts.length ? topicData.posts[0].username : '';

			var feed = new rss({
				title: topicData.title,
				description: description,
				feed_url: nconf.get('url') + '/topic/' + tid + '.rss',
				site_url: nconf.get('url') + '/topic/' + topicData.slug,
				image_url: image_url,
				author: author,
				ttl: 60,
			});
			var dateStamp;

			if (topicData.posts.length > 0) {
				feed.pubDate = new Date(parseInt(topicData.posts[0].timestamp, 10)).toUTCString();
			}

			topicData.posts.forEach((postData) => {
				if (!postData.deleted) {
					dateStamp = new Date(parseInt(parseInt(postData.edited, 10) === 0 ? postData.timestamp : postData.edited, 10)).toUTCString();

					feed.item({
						title: 'Reply to ' + topicData.title + ' on ' + dateStamp,
						description: postData.content,
						url: nconf.get('url') + '/post/' + postData.pid,
						author: postData.user ? postData.user.username : '',
						date: dateStamp,
					});
				}
			});

			sendFeed(feed, res);
		},
	], callback);
}

function generateForCategory(req, res, next) {
	if (parseInt(meta.config['feeds:disableRSS'], 10) === 1) {
		return controllers404.send404(req, res);
	}
	var cid = req.params.category_id;
	var category;

	async.waterfall([
		(next) => {
			async.parallel({
				privileges: (next) => {
					privileges.categories.get(cid, req.uid, next);
				},
				category: (next) => {
					categories.getCategoryById({
						cid: cid,
						set: 'cid:' + cid + ':tids',
						reverse: true,
						start: 0,
						stop: 25,
						uid: req.uid || req.query.uid || 0,
					}, next);
				},
			}, next);
		},
		(results, next) => {
			category = results.category;
			validateTokenIfRequiresLogin(!results.privileges.read, cid, req, res, next);
		},
		(next) => {
			generateTopicsFeed({
				uid: req.uid || req.query.uid || 0,
				title: category.name,
				description: category.description,
				feed_url: '/category/' + cid + '.rss',
				site_url: '/category/' + category.cid,
			}, category.topics, next);
		},
		(feed) => {
			sendFeed(feed, res);
		},
	], next);
}

function generateForRecent(req, res, next) {
	if (parseInt(meta.config['feeds:disableRSS'], 10) === 1) {
		return controllers404.send404(req, res);
	}

	async.waterfall([
		(next) => {
			if (req.query.token && req.query.uid) {
				db.getObjectField('user:' + req.query.uid, 'rss_token', next);
			} else {
				next(null, null);
			}
		},
		(token, next) => {
			next(null, token && token === req.query.token ? req.query.uid : req.uid);
		},
		(uid, next) => {
			generateForTopics({
				uid: uid,
				title: 'Recently Active Topics',
				description: 'A list of topics that have been active within the past 24 hours',
				feed_url: '/recent.rss',
				site_url: '/recent',
			}, 'topics:recent', req, res, next);
		},
	], next);
}

function generateForTop(req, res, next) {
	if (parseInt(meta.config['feeds:disableRSS'], 10) === 1) {
		return controllers404.send404(req, res);
	}

	async.waterfall([
		(next) => {
			if (req.query.token && req.query.uid) {
				db.getObjectField('user:' + req.query.uid, 'rss_token', next);
			} else {
				next(null, null);
			}
		},
		(token, next) => {
			next(null, token && token === req.query.token ? req.query.uid : req.uid);
		},
		(uid, next) => {
			generateForTopics({
				uid: uid,
				title: 'Top Voted Topics',
				description: 'A list of topics that have received the most votes',
				feed_url: '/top.rss',
				site_url: '/top',
			}, 'topics:votes', req, res, next);
		},
	], next);
}

function generateForPopular(req, res, next) {
	if (parseInt(meta.config['feeds:disableRSS'], 10) === 1) {
		return controllers404.send404(req, res);
	}
	var terms = {
		daily: 'day',
		weekly: 'week',
		monthly: 'month',
		alltime: 'alltime',
	};
	var term = terms[req.params.term] || 'day';

	async.waterfall([
		(next) => {
			topics.getPopular(term, req.uid, 19, next);
		},
		(topics, next) => {
			generateTopicsFeed({
				uid: req.uid,
				title: 'Popular Topics',
				description: 'A list of topics that are sorted by post count',
				feed_url: '/popular/' + (req.params.term || 'daily') + '.rss',
				site_url: '/popular/' + (req.params.term || 'daily'),
			}, topics, next);
		},
		(feed) => {
			sendFeed(feed, res);
		},
	], next);
}

function generateForTopics(options, set, req, res, next) {
	var start = options.hasOwnProperty('start') ? options.start : 0;
	var stop = options.hasOwnProperty('stop') ? options.stop : 19;
	async.waterfall([
		(next) => {
			topics.getTopicsFromSet(set, options.uid, start, stop, next);
		},
		(data, next) => {
			generateTopicsFeed(options, data.topics, next);
		},
		(feed) => {
			sendFeed(feed, res);
		},
	], next);
}

function generateTopicsFeed(feedOptions, feedTopics, callback) {
	feedOptions.ttl = 60;
	feedOptions.feed_url = nconf.get('url') + feedOptions.feed_url;
	feedOptions.site_url = nconf.get('url') + feedOptions.site_url;

	feedTopics = feedTopics.filter(Boolean);

	var feed = new rss(feedOptions);

	if (feedTopics.length > 0) {
		feed.pubDate = new Date(parseInt(feedTopics[0].lastposttime, 10)).toUTCString();
	}

	async.each(feedTopics, (topicData, next) => {
		var feedItem = {
			title: topicData.title,
			url: nconf.get('url') + '/topic/' + topicData.slug,
			date: new Date(parseInt(topicData.lastposttime, 10)).toUTCString(),
		};

		if (topicData.teaser && topicData.teaser.user) {
			feedItem.description = topicData.teaser.content;
			feedItem.author = topicData.teaser.user.username;
			feed.item(feedItem);
			return next();
		}

		topics.getMainPost(topicData.tid, feedOptions.uid, (err, mainPost) => {
			if (err) {
				return next(err);
			}
			if (!mainPost) {
				feed.item(feedItem);
				return next();
			}
			feedItem.description = mainPost.content;
			feedItem.author = mainPost.user.username;
			feed.item(feedItem);
			next();
		});
	}, (err) => {
		callback(err, feed);
	});
}

function generateForRecentPosts(req, res, next) {
	if (parseInt(meta.config['feeds:disableRSS'], 10) === 1) {
		return controllers404.send404(req, res);
	}

	async.waterfall([
		(next) => {
			posts.getRecentPosts(req.uid, 0, 19, 'month', next);
		},
		(posts) => {
			var feed = generateForPostsFeed({
				title: 'Recent Posts',
				description: 'A list of recent posts',
				feed_url: '/recentposts.rss',
				site_url: '/recentposts',
			}, posts);

			sendFeed(feed, res);
		},
	], next);
}

function generateForCategoryRecentPosts(req, res, callback) {
	if (parseInt(meta.config['feeds:disableRSS'], 10) === 1) {
		return controllers404.send404(req, res);
	}
	var cid = req.params.category_id;
	var category;
	var posts;
	async.waterfall([
		(next) => {
			async.parallel({
				privileges: (next) => {
					privileges.categories.get(cid, req.uid, next);
				},
				category: (next) => {
					categories.getCategoryData(cid, next);
				},
				posts: (next) => {
					categories.getRecentReplies(cid, req.uid || req.query.uid || 0, 20, next);
				},
			}, next);
		},
		(results, next) => {
			if (!results.category) {
				return controllers404.send404(req, res);
			}
			category = results.category;
			posts = results.posts;
			validateTokenIfRequiresLogin(!results.privileges.read, cid, req, res, next);
		},
		() => {
			var feed = generateForPostsFeed({
				title: category.name + ' Recent Posts',
				description: 'A list of recent posts from ' + category.name,
				feed_url: '/category/' + cid + '/recentposts.rss',
				site_url: '/category/' + cid + '/recentposts',
			}, posts);

			sendFeed(feed, res);
		},
	], callback);
}

function generateForPostsFeed(feedOptions, posts) {
	feedOptions.ttl = 60;
	feedOptions.feed_url = nconf.get('url') + feedOptions.feed_url;
	feedOptions.site_url = nconf.get('url') + feedOptions.site_url;

	var feed = new rss(feedOptions);

	if (posts.length > 0) {
		feed.pubDate = new Date(parseInt(posts[0].timestamp, 10)).toUTCString();
	}

	posts.forEach((postData) => {
		feed.item({
			title: postData.topic ? postData.topic.title : '',
			description: postData.content,
			url: nconf.get('url') + '/post/' + postData.pid,
			author: postData.user ? postData.user.username : '',
			date: new Date(parseInt(postData.timestamp, 10)).toUTCString(),
		});
	});

	return feed;
}

function generateForUserTopics(req, res, callback) {
	if (parseInt(meta.config['feeds:disableRSS'], 10) === 1) {
		return controllers404.send404(req, res);
	}

	var userslug = req.params.userslug;

	async.waterfall([
		(next) => {
			user.getUidByUserslug(userslug, next);
		},
		(uid, next) => {
			if (!uid) {
				return callback();
			}
			user.getUserFields(uid, ['uid', 'username'], next);
		},
		(userData, next) => {
			generateForTopics({
				uid: req.uid,
				title: 'Topics by ' + userData.username,
				description: 'A list of topics that are posted by ' + userData.username,
				feed_url: '/user/' + userslug + '/topics.rss',
				site_url: '/user/' + userslug + '/topics',
			}, 'uid:' + userData.uid + ':topics', req, res, next);
		},
	], callback);
}

function generateForTag(req, res, next) {
	if (parseInt(meta.config['feeds:disableRSS'], 10) === 1) {
		return controllers404.send404(req, res);
	}
	var tag = validator.escape(String(req.params.tag));
	var page = parseInt(req.query.page, 10) || 1;
	var topicsPerPage = meta.config.topicsPerPage || 20;
	var start = Math.max(0, (page - 1) * topicsPerPage);
	var stop = start + topicsPerPage - 1;
	generateForTopics({
		uid: req.uid,
		title: 'Topics tagged with ' + tag,
		description: 'A list of topics that have been tagged with ' + tag,
		feed_url: '/tags/' + tag + '.rss',
		site_url: '/tags/' + tag,
		start: start,
		stop: stop,
	}, 'tag:' + tag + ':topics', req, res, next);
}

function sendFeed(feed, res) {
	var xml = feed.xml();
	res.type('xml').set('Content-Length', Buffer.byteLength(xml)).send(xml);
}
