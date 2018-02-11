

var appearanceController = module.exports;

appearanceController.get = (req, res) => {
	var term = req.params.term ? req.params.term : 'themes';

	res.render('admin/appearance/' + term, {});
};
