

var nconf = require('nconf');
var async = require('async');

var user = require('../../user');
var posts = require('../../posts');
var plugins = require('../../plugins');
var meta = require('../../meta');
var accountHelpers = require('./helpers');
var helpers = require('../helpers');
var pagination = require('../../pagination');
var messaging = require('../../messaging');
var translator = require('../../translator');
var utils = require('../../utils');

var profileController = module.exports;

profileController.get = (req, res, callback) => {
	var lowercaseSlug = req.params.userslug.toLowerCase();

	if (req.params.userslug !== lowercaseSlug) {
		if (res.locals.isAPI) {
			req.params.userslug = lowercaseSlug;
		} else {
			return res.redirect(nconf.get('relative_path') + '/user/' + lowercaseSlug);
		}
	}
	var page = Math.max(1, parseInt(req.query.page, 10) || 1);
	var itemsPerPage = 10;
	var start = (page - 1) * itemsPerPage;
	var stop = start + itemsPerPage - 1;
	var userData;
	async.waterfall([
		(next) => {
			accountHelpers.getUserDataByUserSlug(req.params.userslug, req.uid, next);
		},
		(_userData, next) => {
			if (!_userData) {
				return callback();
			}
			userData = _userData;

			req.session.uids_viewed = req.session.uids_viewed || {};

			if (req.uid !== parseInt(userData.uid, 10) && (!req.session.uids_viewed[userData.uid] || req.session.uids_viewed[userData.uid] < Date.now() - 3600000)) {
				user.incrementUserFieldBy(userData.uid, 'profileviews', 1);
				req.session.uids_viewed[userData.uid] = Date.now();
			}

			async.parallel({
				hasPrivateChat: (next) => {
					messaging.hasPrivateChat(req.uid, userData.uid, next);
				},
				posts: (next) => {
					posts.getPostSummariesFromSet('uid:' + userData.theirid + ':posts', req.uid, start, stop, next);
				},
				signature: (next) => {
					posts.parseSignature(userData, req.uid, next);
				},
				aboutme: (next) => {
					if (userData.aboutme) {
						plugins.fireHook('filter:parse.aboutme', userData.aboutme, next);
					} else {
						next();
					}
				},
			}, next);
		},
		(results, next) => {
			if (parseInt(meta.config['reputation:disabled'], 10) === 1) {
				delete userData.reputation;
			}

			userData.posts = results.posts.posts.filter(p => p && parseInt(p.deleted, 10) !== 1);
			userData.hasPrivateChat = results.hasPrivateChat;
			userData.aboutme = translator.escape(results.aboutme);
			userData.nextStart = results.posts.nextStart;
			userData.breadcrumbs = helpers.buildBreadcrumbs([{ text: userData.username }]);
			userData.title = userData.username;
			var pageCount = Math.ceil(userData.postcount / itemsPerPage);
			userData.pagination = pagination.create(page, pageCount, req.query);

			if (!parseInt(userData.profileviews, 10)) {
				userData.profileviews = 1;
			}

			var plainAboutMe = userData.aboutme ? utils.stripHTMLTags(utils.decodeHTMLEntities(userData.aboutme)) : '';

			res.locals.metaTags = [
				{
					name: 'title',
					content: userData.fullname || userData.username,
				},
				{
					name: 'description',
					content: plainAboutMe,
				},
				{
					property: 'og:title',
					content: userData.fullname || userData.username,
				},
				{
					property: 'og:description',
					content: plainAboutMe,
				},
			];

			if (userData.picture) {
				res.locals.metaTags.push(
					{
						property: 'og:image',
						content: userData.picture,
						noEscape: true,
					},
					{
						property: 'og:image:url',
						content: userData.picture,
						noEscape: true,
					}
				);
			}
			userData.selectedGroup = userData.groups.find(group => group && group.name === userData.groupTitle);

			plugins.fireHook('filter:user.account', { userData: userData, uid: req.uid }, next);
		},
		(results) => {
			res.render('account/profile', results.userData);
		},
	], callback);
};

