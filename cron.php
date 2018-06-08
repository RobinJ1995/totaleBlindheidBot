<?php
require('common.php');

$time = file_get_contents(FILENAME_TIME);
if ($time === false) {
	die();
}
$time = trim($time);

if (time() > $time) {
	$chatId = trim(file_get_contents(FILENAME_CHATID));
	
	sendMessage($chatId, QUOTES[array_rand (QUOTES)] . PHP_EOL . implode (' ', $members));

	unlink(FILENAME_TIME);
	unlink(FILENAME_CHATID);
}
