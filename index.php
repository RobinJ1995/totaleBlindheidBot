<?php
require('common.php');

date_default_timezone_set('Europe/Dublin');

$input = json_decode (file_get_contents ('php://input'), true);
if (! $input['message'])
	die ('No message');
else if (! $input['message']['chat'])
	die ('No chat');

$message = $input['message']['text'];
$chatId = $input['message']['chat']['id'];

$responses = [
	'rollcall' => QUOTES[array_rand (QUOTES)] . PHP_EOL . implode (' ', $members),
	'trollcall' => QUOTES[array_rand (QUOTES)] . PHP_EOL . implode (' ', $allMembers),
	'schedule' => function ($time) use ($chatId) {
		$time = strtotime($time);
		if ($time === false) {
			return 'Invalid time: ' . $time;
		} else if ($time > time() + SIX_HOURS) {
			return "You can't schedule a roll call more than 6 hours in advance.";
		} else if ($time <= time()) {
			return "That time's already passed.";
		}
		
		file_put_contents(FILENAME_CHATID, $chatId);
		file_put_contents(FILENAME_TIME, $time);
		
		return "Sure! I'll nudge people at " . date('g:ia', $time) . "!";
	},
	'wingman' => function ($user) use ($allMembers, $members) {
		if (!in_array($user, $allMembers))
			return LONELY_WINGMAN_QUOTES[array_rand(LONELY_WINGMAN_QUOTES)] . PHP_EOL . implode(' ', $members);
		
		return WINGMAN_QUOTES[array_rand(WINGMAN_QUOTES)] . PHP_EOL . $user;
	},
	'test' => 'Werkt!',
	'mumble' => 'http://mumble.robinj.be/',
	'discord' => 'https://discord.gg/Vvw2WK',
	'help' => '/rollcall, /trollcall, /schedule <time>, /wingman <user>, /test, /mumble, /discord, /help'
];

if (! starts_with ($message, '/'))
	die ();
$command = substr($message, 1);
if (strstr ($command, ' '))
	$command = substr($command, 0, strpos($command, ' '));
$params = substr($message, strlen($command) + 2);
if (strstr ($command, '@'))
	$command = substr($command, 0, strpos($command, '@'));

if (array_key_exists ($command, $responses)) {
	$response = $responses[$command];
	
	if (is_string($response))
		return sendMessage($chatId, $response);
	
	sendMessage ($chatId, $response($params));
}
