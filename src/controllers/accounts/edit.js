

var async = require('async');

var db = require('../../database');
var user = require('../../user');
var meta = require('../../meta');
var plugins = require('../../plugins');
var helpers = require('../helpers');
var groups = require('../../groups');
var accountHelpers = require('./helpers');
var privileges = require('../../privileges');
var file = require('../../file');

var editController = module.exports;

editController.get = (req, res, callback) => {
	async.waterfall([
		(next) => {
			accountHelpers.getUserDataByUserSlug(req.params.userslug, req.uid, next);
		},
		(userData, next) => {
			if (!userData) {
				return callback();
			}
			userData.maximumSignatureLength = parseInt(meta.config.maximumSignatureLength, 10) || 255;
			userData.maximumAboutMeLength = parseInt(meta.config.maximumAboutMeLength, 10) || 1000;
			userData.maximumProfileImageSize = parseInt(meta.config.maximumProfileImageSize, 10);
			userData.allowProfileImageUploads = parseInt(meta.config.allowProfileImageUploads, 10) === 1;
			userData.allowAccountDelete = parseInt(meta.config.allowAccountDelete, 10) === 1;
			userData.allowWebsite = !userData.isSelf || parseInt(userData.reputation, 10) >= (parseInt(meta.config['min:rep:website'], 10) || 0);
			userData.allowAboutMe = !userData.isSelf || parseInt(userData.reputation, 10) >= (parseInt(meta.config['min:rep:aboutme'], 10) || 0);
			userData.allowSignature = !userData.isSelf || parseInt(userData.reputation, 10) >= (parseInt(meta.config['min:rep:signature'], 10) || 0);
			userData.profileImageDimension = parseInt(meta.config.profileImageDimension, 10) || 200;
			userData.defaultAvatar = user.getDefaultAvatar();

			userData.groups = userData.groups.filter(group => group && group.userTitleEnabled && !groups.isPrivilegeGroup(group.name) && group.name !== 'registered-users');
			userData.groups.forEach((group) => {
				group.selected = group.name === userData.groupTitle;
			});

			userData.title = '[[pages:account/edit, ' + userData.username + ']]';
			userData.breadcrumbs = helpers.buildBreadcrumbs([
				{
					text: userData.username,
					url: '/user/' + userData.userslug,
				},
				{
					text: '[[user:edit]]',
				},
			]);
			userData.editButtons = [];

			plugins.fireHook('filter:user.account.edit', userData, next);
		},
		(userData) => {
			res.render('account/edit', userData);
		},
	], callback);
};

editController.password = (req, res, next) => {
	renderRoute('password', req, res, next);
};

editController.username = (req, res, next) => {
	renderRoute('username', req, res, next);
};

editController.email = (req, res, next) => {
	renderRoute('email', req, res, next);
};

function renderRoute(name, req, res, next) {
	async.waterfall([
		(next) => {
			getUserData(req, next, next);
		},
		(userData) => {
			if (!userData) {
				return next();
			}

			if ((name === 'username' && userData['username:disableEdit']) || (name === 'email' && userData['email:disableEdit'])) {
				return next();
			}

			if (name === 'password') {
				userData.minimumPasswordLength = parseInt(meta.config.minimumPasswordLength, 10);
				userData.minimumPasswordStrength = parseInt(meta.config.minimumPasswordStrength || 0, 10);
			}

			userData.title = '[[pages:account/edit/' + name + ', ' + userData.username + ']]';
			userData.breadcrumbs = helpers.buildBreadcrumbs([
				{
					text: userData.username,
					url: '/user/' + userData.userslug,
				},
				{
					text: '[[user:edit]]',
					url: '/user/' + userData.userslug + '/edit',
				},
				{
					text: '[[user:' + name + ']]',
				},
			]);

			res.render('account/edit/' + name, userData);
		},
	], next);
}

function getUserData(req, next, callback) {
	var userData;
	async.waterfall([
		(next) => {
			accountHelpers.getUserDataByUserSlug(req.params.userslug, req.uid, next);
		},
		(data, next) => {
			userData = data;
			if (!userData) {
				return callback(null, null);
			}
			db.getObjectField('user:' + userData.uid, 'password', next);
		},
		(password, next) => {
			userData.hasPassword = !!password;
			next(null, userData);
		},
	], callback);
}

editController.uploadPicture = (req, res, next) => {
	var userPhoto = req.files.files[0];

	var updateUid;

	async.waterfall([
		(next) => {
			user.getUidByUserslug(req.params.userslug, next);
		},
		(uid, next) => {
			updateUid = uid;

			privileges.users.canEdit(req.uid, uid, next);
		},
		(isAllowed, next) => {
			if (!isAllowed) {
				return helpers.notAllowed(req, res);
			}

			user.uploadCroppedPicture({
				uid: updateUid,
				file: userPhoto,
			}, next);
		},
	], (err, image) => {
		file.delete(userPhoto.path);
		if (err) {
			return next(err);
		}

		res.json([{
			name: userPhoto.name,
			url: image.url,
		}]);
	});
};

editController.uploadCoverPicture = (req, res, next) => {
	var params = JSON.parse(req.body.params);
	var coverPhoto = req.files.files[0];

	user.updateCoverPicture({
		file: coverPhoto,
		uid: params.uid,
	}, (err, image) => {
		file.delete(coverPhoto.path);
		if (err) {
			return next(err);
		}

		res.json([{
			url: image.url,
		}]);
	});
};
