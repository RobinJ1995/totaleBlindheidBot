<?php
require('common.php');

$input = json_decode(file_get_contents('php://input'), true);
if (! $input['message']) {
    die('No message');
} elseif (! $input['message']['chat']) {
    die('No chat');
}

$message = $input['message']['text'];
$chatId = $input['message']['chat']['id'];
$userId = $input['message']['from']['id'];
$username = $input['message']['from']['username'];

if (! starts_with($message, '/')) {
    die();
}

applyUserPreferences($userId);

$responses = [
    'rollcall' => QUOTES[array_rand(QUOTES)] . PHP_EOL . implode(' ', $members),
    'trollcall' => QUOTES[array_rand(QUOTES)] . PHP_EOL . implode(' ', $allMembers),
    'schedule' => function ($time) use ($chatId) {
        $time = strtotime($time);
        if ($time === false) {
            return 'Invalid time: ' . $time;
        } elseif ($time > time() + SIX_HOURS) {
            return "You can't schedule a roll call more than 6 hours in advance.";
        } elseif ($time <= time()) {
            return "That time's already passed.";
        }
        
        file_put_contents(FILENAME_CHATID, $chatId);
        file_put_contents(FILENAME_TIME, $time);
        
        return "Sure! I'll nudge people at " . date('g:ia', $time) . ' (' . date_default_timezone_get() . ')!';
    },
    'wingman' => function ($user) use ($allMembers, $members) {
        if (!in_array($user, $allMembers)) {
            return LONELY_WINGMAN_QUOTES[array_rand(LONELY_WINGMAN_QUOTES)] . PHP_EOL . implode(' ', $members);
        }
        
        return WINGMAN_QUOTES[array_rand(WINGMAN_QUOTES)] . PHP_EOL . $user;
    },
    'timezone' => function ($timezone) use ($userId, $username) {
        if (empty($timezone)) {
            return 'http://php.net/manual/en/timezones.php';
        } elseif (! in_array($timezone, DateTimeZone::listIdentifiers())) {
            return '[' . $username . '] Invalid time zone: ' . $timezone;
        }
        
        $prefs = loadUserPreferences($userId);
        $prefs['timezone'] = $timezone;
        saveUserPreferences($userId, $prefs);
        
        return '[' . $username . '] Time zone updated: ' . $timezone;
    },
    'test' => 'Werkt!',
    'mumble' => 'http://mumble.robinj.be/',
    'discord' => 'https://discord.gg/Vvw2WK',
    'help' => '/rollcall, /trollcall, /schedule <time>, /timezone <timezone>, /wingman <user>, /test, /mumble, /discord, /help'
];

$command = substr($message, 1);
if (strstr($command, ' ')) {
    $command = substr($command, 0, strpos($command, ' '));
}
$params = substr($message, strlen($command) + 2);
if (strstr($command, '@')) {
    $command = substr($command, 0, strpos($command, '@'));
}

if (array_key_exists($command, $responses)) {
    $response = $responses[$command];
    
    if (is_string($response)) {
        return sendMessage($chatId, $response);
    }
    
    sendMessage($chatId, $response($params));
}
