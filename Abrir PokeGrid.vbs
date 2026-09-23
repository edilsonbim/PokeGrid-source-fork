' Abre o PokeGrid sem a janela preta do cmd.
' Dica: clique com o botao direito neste arquivo > Enviar para > Area de trabalho (criar atalho).
' Nenhuma janela de terminal precisa ficar aberta: o app roda solto.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = pasta

' precisa do Node.js instalado
If sh.Run("cmd /c where npm >nul 2>nul", 0, True) <> 0 Then
  MsgBox "O Node.js nao esta instalado." & vbCrLf & _
         "Baixe a versao LTS em https://nodejs.org e instale." & vbCrLf & _
         "Depois abra este arquivo de novo.", 48, "PokeGrid"
  WScript.Quit
End If

' primeira vez ou dependencia alterada por uma atualizacao: instala com a janela visivel
If Not fso.FolderExists(pasta & "\node_modules") Or fso.FileExists(pasta & "\.update-needs-install") Then
  codigo = sh.Run("cmd /c title PokeGrid - instalando dependencias && echo Instalando o necessario, aguarde... && npm install", 1, True)
  If codigo <> 0 Then
    MsgBox "Nao foi possivel instalar as dependencias da atualizacao.", 48, "PokeGrid"
    WScript.Quit
  End If
  If fso.FileExists(pasta & "\.update-needs-install") Then fso.DeleteFile pasta & "\.update-needs-install", True
End If

' abre o app sem janela nenhuma (0 = oculta); usa o Electron local desta copia
' para garantir que o icone abra exatamente o mesmo codigo e perfil de configuracao.
electron = pasta & "\node_modules\electron\dist\electron.exe"
If fso.FileExists(electron) Then
  sh.Run """" & electron & """ """ & pasta & """", 0, False
Else
  sh.Run "cmd /c npm start", 0, False
End If
